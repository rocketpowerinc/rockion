package main

import (
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"rockion/internal/model"
)

func (a *App) SaveImage(name string, data []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveImage(name, data)
}

func (a *App) SaveIconImage(name string, data []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveIconImage(name, data)
}

func (a *App) SaveCoverImage(name string, data []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveCoverImage(name, data)
}

func (a *App) SaveVideo(name string, data []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveVideo(name, data)
}

func (a *App) DeleteAsset(path string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.DeleteAsset(path)
}

func (a *App) DeleteUnusedBookmarkAssets(paths []string) ([]string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.DeleteUnusedBookmarkAssets(paths)
}

func (a *App) OpenAssetInFolder(path string) error {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	full, err := a.vault.AssetFullPath(path)
	if err != nil {
		return err
	}
	switch goruntime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", "/select,"+full).Start()
	case "darwin":
		return exec.Command("open", "-R", full).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(full)).Start()
	}
}

func (a *App) SetNoteCover(path string, cover model.PageCover) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	if err := a.vault.SetCover(path, cover); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.Read(path)
	if err != nil {
		return model.Note{}, err
	}
	return a.withCover(note), nil
}

func (a *App) CoverImageDataURL(path string) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.CoverImageDataURL(path)
}

func (a *App) CoverThumbnailDataURL(path string) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.CoverThumbnailDataURL(path)
}

func (a *App) SetNoteIcon(path, icon string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.SetIcon(path, icon)
}

func (a *App) SaveFile(defaultName, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Save script",
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}
