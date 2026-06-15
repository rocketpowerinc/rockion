package vault

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"rockion/internal/model"
)

const maxPageSettingsSize = 4 << 20

type pageSettingsConfig struct {
	Pages map[string]model.PageSettings `json:"pages"`
}

func (v *Vault) pageSettingsPath() string {
	return filepath.Join(v.Root, ".rockion", "page-settings.json")
}

func (v *Vault) PageSettings(rel string) (model.PageSettings, error) {
	if err := requireUserPath(rel); err != nil {
		return model.PageSettings{}, err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return model.PageSettings{}, err
	}
	if _, err := v.Read(rel); err != nil {
		return model.PageSettings{}, err
	}
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))

	v.pageSettingsMu.Lock()
	defer v.pageSettingsMu.Unlock()
	config, err := v.readPageSettings()
	if err != nil {
		return model.PageSettings{}, err
	}
	return config.Pages[rel], nil
}

func (v *Vault) SetPageSettings(rel string, settings model.PageSettings) error {
	if err := requireUserPath(rel); err != nil {
		return err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return err
	}
	if _, err := v.Read(rel); err != nil {
		return err
	}
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))

	v.pageSettingsMu.Lock()
	defer v.pageSettingsMu.Unlock()
	config, err := v.readPageSettings()
	if err != nil {
		return err
	}
	if !settings.Locked && !settings.FullWidth {
		delete(config.Pages, rel)
	} else {
		config.Pages[rel] = settings
	}
	return v.writePageSettings(config)
}

func (v *Vault) RenamePageSettingsPath(oldRel, newRel string, isDir bool) error {
	v.pageSettingsMu.Lock()
	defer v.pageSettingsMu.Unlock()
	oldRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(oldRel)))
	newRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(newRel)))
	config, err := v.readPageSettings()
	if err != nil {
		return err
	}
	changed := false
	for path, settings := range config.Pages {
		mapped, ok := mapRenamedPath(path, oldRel, newRel, isDir)
		if !ok {
			continue
		}
		delete(config.Pages, path)
		config.Pages[mapped] = settings
		changed = true
	}
	if !changed {
		return nil
	}
	return v.writePageSettings(config)
}

func (v *Vault) RemovePageSettingsPath(rel string, isDir bool) error {
	v.pageSettingsMu.Lock()
	defer v.pageSettingsMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	config, err := v.readPageSettings()
	if err != nil {
		return err
	}
	changed := false
	for path := range config.Pages {
		if path == rel || (isDir && strings.HasPrefix(path, rel+"/")) {
			delete(config.Pages, path)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return v.writePageSettings(config)
}

func (v *Vault) readPageSettings() (pageSettingsConfig, error) {
	config := pageSettingsConfig{Pages: map[string]model.PageSettings{}}
	info, err := os.Lstat(v.pageSettingsPath())
	if errors.Is(err, os.ErrNotExist) {
		return config, nil
	}
	if err != nil {
		return config, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		info.Size() > maxPageSettingsSize {
		return config, errors.New("page settings metadata is invalid")
	}
	data, err := os.ReadFile(v.pageSettingsPath())
	if err != nil {
		return config, err
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return pageSettingsConfig{}, err
	}
	if config.Pages == nil {
		config.Pages = map[string]model.PageSettings{}
	}
	return config, nil
}

func (v *Vault) writePageSettings(config pageSettingsConfig) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	if len(config.Pages) == 0 {
		if err := os.Remove(v.pageSettingsPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if info, err := os.Lstat(v.pageSettingsPath()); err == nil &&
		info.Mode()&os.ModeSymlink != 0 {
		return errors.New("page settings sidecar cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > maxPageSettingsSize {
		return errors.New("page settings sidecar exceeds the 4 MB limit")
	}
	return atomicWriteFile(v.pageSettingsPath(), data, 0o644)
}
