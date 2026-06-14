package main

import (
	"os"

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
