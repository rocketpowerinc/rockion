package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

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

	mu      sync.RWMutex
	vault   *vault.Vault
	db      *db.DB
	indexer *indexer.Indexer
	search  *search.Search
	watcher *fsnotify.Watcher

	indexCancel     context.CancelFunc
	indexWG         sync.WaitGroup
	watcherWG       sync.WaitGroup
	watcherDebounce *keyedDebouncer

	closeMu    sync.Mutex
	allowClose bool
	updateMu   sync.Mutex
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closeVault()
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	if a.allowClose {
		return false
	}
	runtime.EventsEmit(ctx, "app:before-close")
	return true
}

// ConfirmClose is called after the frontend flushes pending editor text.
func (a *App) ConfirmClose() {
	a.closeMu.Lock()
	a.allowClose = true
	a.closeMu.Unlock()
	runtime.Quit(a.ctx)
}

func (a *App) closeVault() {
	if a.watcher != nil {
		_ = a.watcher.Close()
		a.watcher = nil
	}
	if a.indexCancel != nil {
		a.indexCancel()
		a.indexCancel = nil
	}
	if a.watcherDebounce != nil {
		a.watcherDebounce.Close()
		a.watcherDebounce = nil
	}
	a.watcherWG.Wait()
	a.indexWG.Wait()
	if a.db != nil {
		_ = a.db.Close()
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
	if err := v.EnsureRootDashboards(); err != nil {
		return model.VaultInfo{}, fmt.Errorf("create folder dashboards: %w", err)
	}
	if err := v.EnsureManagedDashboards(); err != nil {
		return model.VaultInfo{}, fmt.Errorf("prepare managed project pages: %w", err)
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
	indexCtx, cancel := context.WithCancel(a.ctx)
	a.indexCancel = cancel
	a.indexWG.Add(1)
	go func() {
		defer a.indexWG.Done()
		defer func() {
			if r := recover(); r != nil {
				runtime.LogErrorf(a.ctx, "index rebuild panicked: %v", r)
			}
		}()
		if err := ix.RebuildContext(indexCtx); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
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

func (a *App) withCover(note model.Note) model.Note {
	note.Cover = a.vault.Cover(note.Path)
	return note
}

func (a *App) ListTree() ([]model.TreeNode, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.SidebarTree()
}

func (a *App) ListPages() ([]model.TreeNode, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.Pages()
}

func (a *App) ListFavorites() ([]model.TreeNode, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.Favorites()
}

func (a *App) SetFavorite(path string, favorite bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.SetFavorite(path, favorite)
}

func (a *App) ReorderFavorites(paths []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.ReorderFavorites(paths)
}

func (a *App) ReadNote(path string) (model.Note, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.Read(path)
	if err != nil {
		return model.Note{}, err
	}
	return a.withCover(note), nil
}

func (a *App) WriteNote(path, markdown, expectedVersion string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	if err := a.vault.WriteExpected(path, markdown, expectedVersion); err != nil {
		if errors.Is(err, vault.ErrConflict) {
			return model.Note{}, fmt.Errorf("conflict: %w", err)
		}
		return model.Note{}, err
	}
	if _, err := a.vault.NormalizeManagedDashboard(path); err != nil {
		return model.Note{}, fmt.Errorf("normalize managed dashboard links: %w", err)
	}
	saved, err := a.vault.Read(path)
	if err != nil {
		return model.Note{}, err
	}
	if err := a.indexer.IndexFile(path); err != nil {
		runtime.LogErrorf(a.ctx, "index saved note failed: %v", err)
	}
	return a.withCover(saved), nil
}

func (a *App) CreateProject(title string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.CreateProject(title)
	if err != nil {
		return model.Note{}, err
	}
	if a.watcher != nil {
		if err := addWatchDirs(a.watcher, filepath.Join(a.vault.Root, filepath.Dir(filepath.FromSlash(note.Path)))); err != nil {
			runtime.LogErrorf(a.ctx, "watch new project failed: %v", err)
		}
	}
	if err := a.indexer.IndexFile(note.Path); err != nil {
		runtime.LogErrorf(a.ctx, "index project dashboard failed: %v", err)
	}
	return note, nil
}

func (a *App) RenamePath(oldPath, newPath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.renamePathLocked(oldPath, newPath)
}

func (a *App) renamePathLocked(oldPath, newPath string) error {
	if err := a.requireVault(); err != nil {
		return err
	}
	isDir, err := a.vault.IsDir(oldPath)
	if err != nil {
		return err
	}
	linkCandidates, err := a.indexer.RenameCandidates(oldPath, isDir)
	if err != nil {
		return fmt.Errorf("find links to rewrite: %w", err)
	}
	if err := a.vault.Rename(oldPath, newPath); err != nil {
		return err
	}
	var followUpErrs []error
	if err := a.vault.RenameIconPath(oldPath, newPath, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rename icon metadata: %w", err))
	}
	if err := a.vault.RenameCoverPath(oldPath, newPath, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rename cover metadata: %w", err))
	}
	if err := a.vault.RenameFavoritePath(oldPath, newPath, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rename favorite metadata: %w", err))
	}
	if err := a.vault.RenameDashboardViewPath(oldPath, newPath, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rename dashboard view metadata: %w", err))
	}
	rewritten, rewriteErr := a.vault.RewriteLinksAfterRename(
		oldPath,
		newPath,
		isDir,
		linkCandidates,
	)
	if rewriteErr != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rewrite links: %w", rewriteErr))
	}
	if !isDir {
		dashboardPath, changed, err := a.vault.NormalizeDashboardForPage(newPath)
		if err != nil {
			followUpErrs = append(followUpErrs, fmt.Errorf("update managed dashboard link: %w", err))
		} else if changed {
			rewritten = append(rewritten, dashboardPath)
		}
	}
	if err := a.indexer.ApplyRename(oldPath, newPath, isDir, rewritten); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("update index: %w", err))
	}
	return errors.Join(followUpErrs...)
}

// RenameToTitle renames a note so its filename matches the given title,
// appending " N" if that name is already taken. It returns the moved note.
func (a *App) RenameToTitle(path, title string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	if strings.EqualFold(filepath.Base(filepath.FromSlash(path)), "dashboard.md") {
		note, err := a.vault.Read(path)
		if err != nil {
			return model.Note{}, err
		}
		return a.withCover(note), nil
	}
	newRel, changed, err := a.vault.PlanTitleRename(path, title)
	if err != nil {
		return model.Note{}, err
	}
	if changed {
		if err := a.renamePathLocked(path, newRel); err != nil {
			return model.Note{}, err
		}
		path = newRel
	} else {
		dashboardPath, dashboardChanged, err := a.vault.NormalizeDashboardForPage(path)
		if err != nil {
			return model.Note{}, fmt.Errorf("update managed dashboard link: %w", err)
		}
		if dashboardChanged && a.indexer != nil {
			if err := a.indexer.IndexFile(dashboardPath); err != nil {
				return model.Note{}, fmt.Errorf("index updated dashboard: %w", err)
			}
		}
	}
	note, err := a.vault.Read(path)
	if err != nil {
		return model.Note{}, err
	}
	return a.withCover(note), nil
}

func (a *App) DeletePath(path string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	if filepath.Dir(filepath.FromSlash(clean)) != "." && !vault.IsDashboardPath(clean) {
		return errors.New("project pages must be deleted from their dashboard link")
	}
	isDir, err := a.vault.IsDir(path)
	if err != nil {
		return err
	}
	if err := a.vault.Delete(path); err != nil {
		return err
	}
	var followUpErrs []error
	if err := a.vault.RemoveIconPath(path, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove icon metadata: %w", err))
	}
	if err := a.vault.RemoveCoverPath(path, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove cover metadata: %w", err))
	}
	if err := a.vault.RemoveFavoritePath(path, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove favorite metadata: %w", err))
	}
	if err := a.vault.RemoveDashboardViewPath(path, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove dashboard view metadata: %w", err))
	}
	if err := a.indexer.RemovePath(path); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove index path: %w", err))
	}
	return errors.Join(followUpErrs...)
}

func (a *App) Search(query string, limit int) ([]model.SearchHit, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.search.Query(query, limit)
}

func (a *App) Backlinks(path string) ([]model.SearchHit, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.search.Backlinks(path)
}
