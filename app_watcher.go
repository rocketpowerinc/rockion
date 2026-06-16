package main

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"rockion/internal/vault"
)

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
			if recovered := recover(); recovered != nil {
				runtime.LogErrorf(a.ctx, "watcher panicked: %v", recovered)
			}
		}()
		for {
			select {
			case event, ok := <-w.Events:
				if !ok {
					return
				}
				if shouldSkipWatchPath(event.Name, root) {
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

func addWatchDirs(watcher *fsnotify.Watcher, root string) error {
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
			if strings.HasPrefix(name, ".") || name == "node_modules" || strings.EqualFold(name, "Assets") {
				return filepath.SkipDir
			}
		}
		return watcher.Add(path)
	})
}

// removeWatchDirs releases Windows directory handles before a folder move.
// Watches are removed deepest-first because child watches outlive their parent.
func removeWatchDirs(watcher *fsnotify.Watcher, root string) error {
	dirs := []string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			dirs = append(dirs, path)
		}
		return nil
	})
	if err != nil {
		return err
	}
	sort.Slice(dirs, func(i, j int) bool {
		return len(dirs[i]) > len(dirs[j])
	})
	var removeErrs []error
	for _, dir := range dirs {
		if err := watcher.Remove(dir); err != nil &&
			!errors.Is(err, os.ErrNotExist) {
			removeErrs = append(removeErrs, err)
		}
	}
	return errors.Join(removeErrs...)
}

func shouldSkipWatchPath(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return false
	}
	for _, part := range strings.Split(filepath.Clean(rel), string(filepath.Separator)) {
		if strings.HasPrefix(part, ".") || part == "node_modules" || strings.EqualFold(part, "Assets") {
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
