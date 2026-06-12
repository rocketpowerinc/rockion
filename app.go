package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"rockion/internal/db"
	"rockion/internal/indexer"
	"rockion/internal/model"
	"rockion/internal/search"
	"rockion/internal/vault"
)

// App is the Wails-bound application struct. Its exported methods are callable from JS.
type App struct {
	ctx context.Context

	mu      sync.Mutex
	vault   *vault.Vault
	db      *db.DB
	indexer *indexer.Indexer
	search  *search.Search
	watcher *fsnotify.Watcher
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context)  { a.ctx = ctx }
func (a *App) shutdown(ctx context.Context) { a.closeVault() }

func (a *App) closeVault() {
	if a.watcher != nil {
		a.watcher.Close()
		a.watcher = nil
	}
	if a.db != nil {
		a.db.Close()
		a.db = nil
	}
	a.vault = nil
	a.indexer = nil
	a.search = nil
}

// --- Bound methods (Go → JS) ---

// PickVault opens a native folder picker and opens the chosen vault.
func (a *App) PickVault() (model.VaultInfo, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose a vault folder",
	})
	if err != nil {
		return model.VaultInfo{}, err
	}
	if dir == "" {
		return model.VaultInfo{}, errors.New("no folder selected")
	}
	return a.OpenVault(dir)
}

// OpenVault opens a vault at the given path, builds the index, and starts watching.
func (a *App) OpenVault(path string) (model.VaultInfo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.closeVault()

	v, err := vault.Open(path)
	if err != nil {
		return model.VaultInfo{}, err
	}
	d, err := db.Open(path)
	if err != nil {
		return model.VaultInfo{}, err
	}
	ix := indexer.New(v, d)

	a.vault = v
	a.db = d
	a.indexer = ix
	a.search = search.New(d)

	// Index in the background so the window opens instantly. Recover from any
	// panic here so a bad file or DB issue can never crash the whole app.
	go func() {
		defer func() {
			if r := recover(); r != nil {
				runtime.LogErrorf(a.ctx, "index rebuild panicked: %v", r)
			}
		}()
		if err := ix.Rebuild(); err != nil {
			runtime.LogErrorf(a.ctx, "index rebuild failed: %v", err)
			return
		}
		runtime.EventsEmit(a.ctx, "index:ready")
	}()

	a.startWatcher()
	return v.Info(), nil
}

func (a *App) requireVault() error {
	if a.vault == nil {
		return errors.New("no vault open")
	}
	return nil
}

func (a *App) ListTree() ([]model.TreeNode, error) {
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.Tree()
}

func (a *App) ReadNote(path string) (model.Note, error) {
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	return a.vault.Read(path)
}

func (a *App) WriteNote(path, markdown string) error {
	if err := a.requireVault(); err != nil {
		return err
	}
	if err := a.vault.Write(path, markdown); err != nil {
		return err
	}
	return a.indexer.IndexFile(path)
}

func (a *App) CreateNote(dir, title string) (model.Note, error) {
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.Create(dir, title)
	if err != nil {
		return model.Note{}, err
	}
	a.indexer.IndexFile(note.Path)
	return note, nil
}

func (a *App) RenamePath(oldPath, newPath string) error {
	if err := a.requireVault(); err != nil {
		return err
	}
	if err := a.vault.Rename(oldPath, newPath); err != nil {
		return err
	}
	a.indexer.RemoveFile(oldPath)
	if strings.EqualFold(filepath.Ext(newPath), ".md") {
		a.indexer.IndexFile(newPath)
	}
	return nil
}

func (a *App) DeletePath(path string) error {
	if err := a.requireVault(); err != nil {
		return err
	}
	if err := a.vault.Delete(path); err != nil {
		return err
	}
	return a.indexer.RemoveFile(path)
}

func (a *App) Search(query string, limit int) ([]model.SearchHit, error) {
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.search.Query(query, limit)
}

func (a *App) Backlinks(path string) ([]model.SearchHit, error) {
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.search.Backlinks(path)
}

// SaveImage stores image bytes in assets/ and returns the vault-relative path.
func (a *App) SaveImage(name string, data []byte) (string, error) {
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveImage(name, data)
}

// SetNoteIcon sets (or clears, if icon == "") the emoji icon for a note.
func (a *App) SetNoteIcon(path, icon string) error {
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.SetIcon(path, icon)
}

// SaveFile prompts for a save location and writes content there. Returns the
// chosen path, or "" if the user cancelled. Backs the code block download button.
func (a *App) SaveFile(defaultName, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Save script",
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // cancelled
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// --- File watching: reflect external edits (Obsidian, git, etc.) ---

func isMarkdownPath(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown" || ext == ".mdx"
}

func (a *App) startWatcher() {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	a.watcher = w
	// Watch the root; for nested folders a production build would walk and add each.
	_ = w.Add(a.vault.Root)

	debounce := newDebouncer(300 * time.Millisecond)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				runtime.LogErrorf(a.ctx, "watcher panicked: %v", r)
			}
		}()
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if !isMarkdownPath(ev.Name) {
					continue
				}
				if strings.Contains(ev.Name, string(filepath.Separator)+".rockion") {
					continue
				}
				debounce(func() {
					a.mu.Lock()
					ix := a.indexer
					root := ""
					if a.vault != nil {
						root = a.vault.Root
					}
					a.mu.Unlock()
					if ix == nil || root == "" {
						return // vault closed; nothing to do
					}
					rel, err := filepath.Rel(root, ev.Name)
					if err != nil {
						return
					}
					rel = filepath.ToSlash(rel)
					if ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
						ix.RemoveFile(rel)
					} else {
						ix.IndexFile(rel)
					}
					runtime.EventsEmit(a.ctx, "vault:changed", rel)
				})
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}()
}

// newDebouncer returns a function that delays the most recent call by d.
func newDebouncer(d time.Duration) func(func()) {
	var mu sync.Mutex
	var t *time.Timer
	return func(fn func()) {
		mu.Lock()
		defer mu.Unlock()
		if t != nil {
			t.Stop()
		}
		t = time.AfterFunc(d, fn)
	}
}
