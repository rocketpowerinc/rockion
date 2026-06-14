package main

import (
	"errors"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"rockion/internal/model"
	"rockion/internal/vault"
)

func (a *App) ListDashboardCards(dashboardPath string) ([]model.PageCard, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return nil, err
	}
	return a.vault.DashboardCards(dashboardPath)
}

func (a *App) GetDashboardView(dashboardPath string) (model.DashboardView, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return model.DashboardView{}, err
	}
	return a.vault.DashboardView(dashboardPath)
}

func (a *App) SetDashboardView(dashboardPath string, view model.DashboardView) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.SetDashboardView(dashboardPath, view)
}

func (a *App) ReorderManagedPages(dashboardPath string, pageIDs []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	if err := a.vault.ReorderManagedPages(dashboardPath, pageIDs); err != nil {
		return err
	}
	if err := a.indexer.IndexFile(dashboardPath); err != nil {
		runtime.LogErrorf(a.ctx, "index reordered dashboard failed: %v", err)
	}
	return nil
}

func (a *App) CreateSubPage(dashboardPath, title string) (model.Note, error) {
	return a.createSubPage(dashboardPath, title, "")
}

func (a *App) CreateSubPageFromTemplate(
	dashboardPath, title, template string,
) (model.Note, error) {
	return a.createSubPage(dashboardPath, title, template)
}

func (a *App) createSubPage(dashboardPath, title, template string) (model.Note, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return model.Note{}, err
	}
	note, err := a.vault.CreateManagedPageFromTemplate(dashboardPath, title, template)
	if err != nil {
		return model.Note{}, err
	}
	if err := a.indexer.IndexFile(note.Path); err != nil {
		runtime.LogErrorf(a.ctx, "index created note failed: %v", err)
	}
	return note, nil
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
	if err := a.vault.RemoveCoverPath(result.DeletedPath, false); err != nil {
		followUpErrs = append(followUpErrs, fmt.Errorf("remove cover metadata: %w", err))
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
		return a.withCover(result.Dashboard), err
	}
	return a.withCover(result.Dashboard), nil
}
