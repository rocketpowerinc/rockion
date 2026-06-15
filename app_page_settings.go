package main

import (
	"rockion/internal/model"
)

func (a *App) GetPageSettings(path string) (model.PageSettings, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return model.PageSettings{}, err
	}
	return a.vault.PageSettings(path)
}

func (a *App) SetPageSettings(path string, settings model.PageSettings) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.requireVault(); err != nil {
		return err
	}
	return a.vault.SetPageSettings(path, settings)
}
