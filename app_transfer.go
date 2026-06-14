package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"rockion/internal/model"
	"rockion/internal/vaultbackup"
)

func (a *App) ExportVault(password string) (string, error) {
	a.mu.RLock()
	if err := a.requireVault(); err != nil {
		a.mu.RUnlock()
		return "", err
	}
	root := a.vault.Root
	name := a.vault.Info().Name
	a.mu.RUnlock()

	timestamp := time.Now().Format("2006-01-02_150405")
	defaultName := fmt.Sprintf("%s-%s.rockion", name, timestamp)
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

	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	if a.vault.Root != root {
		return "", errors.New("the open vault changed before export started")
	}
	if err := vaultbackup.Export(root, path, password); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) PickVaultImportArchive() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose an encrypted Rockion vault",
		Filters: []runtime.FileFilter{
			{DisplayName: "Rockion Vault Archive (*.rockion)", Pattern: "*.rockion"},
		},
	})
}

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
