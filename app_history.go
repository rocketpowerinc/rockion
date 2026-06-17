package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"

	"rockion/internal/model"
	"rockion/internal/vault"
)

func (a *App) ListPageHistory(path string) ([]model.PageHistoryVersion, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.ListPageHistory(path)
}

func (a *App) ReadHistoryVersion(path, versionID string) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.ReadHistoryVersion(path, versionID)
}

func (a *App) RestoreHistoryVersion(path, versionID string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	markdown, err := a.vault.ReadHistoryVersion(path, versionID)
	if err != nil {
		return model.Note{}, err
	}
	current, err := a.vault.Read(path)
	if err != nil {
		return model.Note{}, err
	}
	a.snapshotNote(current, markdown, "restore")
	if err := a.vault.WriteExpected(path, markdown, current.Version); err != nil {
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
	if a.indexer != nil {
		if err := a.indexer.IndexFile(path); err != nil {
			return model.Note{}, fmt.Errorf("index restored note: %w", err)
		}
	}
	return a.withCover(saved), nil
}

func (a *App) RecentHistory(limit int) ([]model.PageHistorySummary, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.RecentHistory(limit)
}

func (a *App) ClearHistory() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.ClearHistory()
}

func (a *App) RecentHistoryForVault(path string, limit int) ([]model.PageHistorySummary, error) {
	v, err := vault.Open(path)
	if err != nil {
		return nil, err
	}
	items, err := v.RecentHistory(limit)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].VaultPath = v.Root
		items[i].VaultName = filepath.Base(v.Root)
	}
	return items, nil
}

func (a *App) ClearHistoryForVault(path string) error {
	v, err := vault.Open(path)
	if err != nil {
		return err
	}
	return v.ClearHistory()
}

func (a *App) RecentHistoryForVaults(paths []string, limit int) ([]model.PageHistorySummary, error) {
	if limit <= 0 {
		limit = 6
	}
	items := []model.PageHistorySummary{}
	for _, path := range paths {
		vaultItems, err := a.RecentHistoryForVault(path, limit)
		if err != nil {
			continue
		}
		items = append(items, vaultItems...)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].UpdatedAt > items[j].UpdatedAt
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}
