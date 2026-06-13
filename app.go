package main

import (
	"context"
	"errors"
	"fmt"
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
	"rockion/internal/vaultbackup"
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
	return a.vault.Read(path)
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
	return saved, nil
}

func (a *App) CreateSubPage(dashboardPath, title string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.CreateManagedPage(dashboardPath, title)
	if err != nil {
		return model.Note{}, err
	}
	if err := a.indexer.IndexFile(note.Path); err != nil {
		runtime.LogErrorf(a.ctx, "index created note failed: %v", err)
	}
	return note, nil
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
	if err := a.vault.RenameFavoritePath(oldPath, newPath, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("rename favorite metadata: %w", err))
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
		return a.vault.Read(path)
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
	return a.vault.Read(path)
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
	if err := a.vault.RemoveFavoritePath(path, isDir); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove favorite metadata: %w", err))
	}
	if err := a.indexer.RemovePath(path); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove index path: %w", err))
	}
	return errors.Join(followUpErrs...)
}

func (a *App) DeleteManagedPage(
	dashboardPath, href, expectedVersion string,
) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	result, err := a.vault.DeleteManagedPage(dashboardPath, href, expectedVersion)
	if err != nil {
		if errors.Is(err, vault.ErrConflict) {
			return model.Note{}, fmt.Errorf("conflict: %w", err)
		}
		return model.Note{}, err
	}
	var followUpErrs []error
	if err := a.vault.RemoveIconPath(result.DeletedPath, false); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove icon metadata: %w", err))
	}
	if err := a.vault.RemoveFavoritePath(result.DeletedPath, false); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove favorite metadata: %w", err))
	}
	if err := a.indexer.RemovePath(result.DeletedPath); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove deleted page from index: %w", err))
	}
	if err := a.indexer.IndexFile(dashboardPath); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("index updated dashboard: %w", err))
	}
	if err := errors.Join(followUpErrs...); err != nil {
		return result.Dashboard, err
	}
	return result.Dashboard, nil
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

// SaveImage stores image bytes in assets/ and returns the vault-relative path.
func (a *App) SaveImage(name string, data []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveImage(name, data)
}

// SetNoteIcon sets (or clears, if icon == "") the emoji icon for a note.
func (a *App) SetNoteIcon(path, icon string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
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

// ExportVault prompts for a destination and writes an authenticated, encrypted
// snapshot of the currently open vault. The password is never written to disk.
func (a *App) ExportVault(password string) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	timestamp := time.Now().Format("2006-01-02_150405")
	defaultName := fmt.Sprintf("%s-%s.rockion", a.vault.Info().Name, timestamp)
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Export encrypted Rockion vault",
		Filters: []runtime.FileFilter{
			{DisplayName: "Rockion Vault Archive (*.rockion)", Pattern: "*.rockion"},
		},
	})
	if err != nil || path == "" {
		return path, err
	}
	if !strings.EqualFold(filepath.Ext(path), ".rockion") {
		path += ".rockion"
	}
	if err := vaultbackup.Export(a.vault.Root, path, password); err != nil {
		return "", err
	}
	return path, nil
}

// PickVaultImportArchive prompts for the encrypted archive to restore.
func (a *App) PickVaultImportArchive() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose an encrypted Rockion vault",
		Filters: []runtime.FileFilter{
			{DisplayName: "Rockion Vault Archive (*.rockion)", Pattern: "*.rockion"},
		},
	})
}

// ImportVault decrypts an archive into a newly created folder and opens it.
func (a *App) ImportVault(archivePath, password string) (model.VaultInfo, error) {
	if strings.TrimSpace(archivePath) == "" {
		return model.VaultInfo{}, errors.New("no archive selected")
	}
	parent, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose where to restore the imported vault",
	})
	if err != nil {
		return model.VaultInfo{}, err
	}
	if parent == "" {
		return model.VaultInfo{}, errors.New("no restore location selected")
	}
	path, err := vaultbackup.Import(archivePath, parent, password)
	if err != nil {
		return model.VaultInfo{}, err
	}
	info, err := a.OpenVault(path)
	if err != nil {
		return model.VaultInfo{}, fmt.Errorf("vault restored to %s but could not be opened: %w", path, err)
	}
	return info, nil
}

// --- File watching: reflect external edits (Obsidian, git, etc.) ---

func isMarkdownPath(name string) bool {
	return vault.IsMarkdownPath(name)
}

func (a *App) startWatcher() {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	if err := addWatchDirs(w, a.vault.Root); err != nil {
		_ = w.Close()
		runtime.LogErrorf(a.ctx, "watcher setup failed: %v", err)
		return
	}
	a.watcher = w

	debounce := newKeyedDebouncer(300 * time.Millisecond)
	a.watcherDebounce = debounce
	ix := a.indexer
	root := a.vault.Root
	a.watcherWG.Add(1)
	go func() {
		defer a.watcherWG.Done()
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
				event := ev
				if shouldSkipWatchPath(event.Name, a.vault.Root) {
					continue
				}
				info, statErr := os.Stat(event.Name)
				isDir := statErr == nil && info.IsDir()
				if isDir && event.Op&fsnotify.Create != 0 {
					if err := addWatchDirs(w, event.Name); err != nil {
						runtime.LogErrorf(a.ctx, "watch nested directory failed: %v", err)
					}
				}
				if !isDir && !isMarkdownPath(event.Name) &&
					event.Op&(fsnotify.Remove|fsnotify.Rename) == 0 {
					continue
				}
				debounce.Do(event.Name, func() {
					rel, err := filepath.Rel(root, event.Name)
					if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
						return
					}
					rel = filepath.ToSlash(rel)
					if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
						if err := ix.RemovePath(rel); err != nil {
							runtime.LogErrorf(a.ctx, "remove index path failed: %v", err)
						}
					} else {
						info, err := os.Stat(event.Name)
						if err == nil && info.IsDir() {
							if err := ix.Rebuild(); err != nil {
								runtime.LogErrorf(a.ctx, "rebuild after directory change failed: %v", err)
							}
						} else if isMarkdownPath(rel) {
							if err := ix.IndexFile(rel); err != nil {
								runtime.LogErrorf(a.ctx, "index changed file failed: %v", err)
							}
						}
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

func addWatchDirs(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root {
			name := entry.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "assets" {
				return filepath.SkipDir
			}
		}
		return w.Add(path)
	})
}

func shouldSkipWatchPath(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return false
	}
	for _, part := range strings.Split(filepath.Clean(rel), string(filepath.Separator)) {
		if strings.HasPrefix(part, ".") || part == "node_modules" || part == "assets" {
			return true
		}
	}
	return false
}

type debounceEntry struct {
	timer *time.Timer
	done  sync.Once
}

type keyedDebouncer struct {
	mu     sync.Mutex
	delay  time.Duration
	timers map[string]*debounceEntry
	wg     sync.WaitGroup
	closed bool
}

func newKeyedDebouncer(delay time.Duration) *keyedDebouncer {
	return &keyedDebouncer{delay: delay, timers: map[string]*debounceEntry{}}
}

func (d *keyedDebouncer) Do(key string, fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return
	}
	if previous := d.timers[key]; previous != nil && previous.timer.Stop() {
		previous.done.Do(d.wg.Done)
	}
	entry := &debounceEntry{}
	d.wg.Add(1)
	entry.timer = time.AfterFunc(d.delay, func() {
		defer entry.done.Do(d.wg.Done)
		d.mu.Lock()
		if d.closed {
			d.mu.Unlock()
			return
		}
		delete(d.timers, key)
		d.mu.Unlock()
		fn()
	})
	d.timers[key] = entry
}

func (d *keyedDebouncer) Close() {
	d.mu.Lock()
	d.closed = true
	for key, entry := range d.timers {
		if entry.timer.Stop() {
			entry.done.Do(d.wg.Done)
		}
		delete(d.timers, key)
	}
	d.mu.Unlock()
	d.wg.Wait()
}
