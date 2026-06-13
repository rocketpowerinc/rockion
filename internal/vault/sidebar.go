package vault

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"rockion/internal/model"
)

type sidebarConfig struct {
	Favorites []string `json:"favorites"`
}

func (v *Vault) sidebarPath() string {
	return filepath.Join(v.Root, ".rockion", "sidebar.json")
}

// Favorites returns valid favorite notes in the user's saved order.
func (v *Vault) Favorites() ([]model.TreeNode, error) {
	v.sidebarMu.Lock()
	defer v.sidebarMu.Unlock()
	config, err := v.readSidebar()
	if err != nil {
		return nil, err
	}
	icons := v.Icons()
	nodes := make([]model.TreeNode, 0, len(config.Favorites))
	valid := make([]string, 0, len(config.Favorites))
	for _, path := range config.Favorites {
		note, err := v.read(path, icons)
		if err != nil {
			continue
		}
		valid = append(valid, note.Path)
		nodes = append(nodes, model.TreeNode{
			Name: note.Title,
			Path: note.Path,
			Icon: icons[note.Path],
		})
	}
	if !slices.Equal(valid, config.Favorites) {
		config.Favorites = valid
		if err := v.writeSidebar(config); err != nil {
			return nil, err
		}
	}
	return nodes, nil
}

func (v *Vault) SetFavorite(path string, favorite bool) error {
	note, err := v.Read(path)
	if err != nil {
		return err
	}
	path = note.Path
	v.sidebarMu.Lock()
	defer v.sidebarMu.Unlock()
	config, err := v.readSidebar()
	if err != nil {
		return err
	}
	index := slices.Index(config.Favorites, path)
	if favorite && index < 0 {
		config.Favorites = append(config.Favorites, path)
	} else if !favorite && index >= 0 {
		config.Favorites = append(config.Favorites[:index], config.Favorites[index+1:]...)
	} else {
		return nil
	}
	return v.writeSidebar(config)
}

func (v *Vault) ReorderFavorites(paths []string) error {
	v.sidebarMu.Lock()
	defer v.sidebarMu.Unlock()
	config, err := v.readSidebar()
	if err != nil {
		return err
	}
	if len(paths) != len(config.Favorites) {
		return errors.New("favorite order does not contain every favorite")
	}
	expected := make(map[string]struct{}, len(config.Favorites))
	for _, path := range config.Favorites {
		expected[path] = struct{}{}
	}
	ordered := make([]string, 0, len(paths))
	for _, path := range paths {
		path = filepath.ToSlash(filepath.Clean(path))
		if _, ok := expected[path]; !ok {
			return errors.New("favorite order contains an unknown page")
		}
		delete(expected, path)
		ordered = append(ordered, path)
	}
	if len(expected) != 0 {
		return errors.New("favorite order is incomplete")
	}
	config.Favorites = ordered
	return v.writeSidebar(config)
}

func (v *Vault) RenameFavoritePath(oldRel, newRel string, isDir bool) error {
	v.sidebarMu.Lock()
	defer v.sidebarMu.Unlock()
	oldRel = filepath.ToSlash(filepath.Clean(oldRel))
	newRel = filepath.ToSlash(filepath.Clean(newRel))
	config, err := v.readSidebar()
	if err != nil {
		return err
	}
	changed := false
	for index, path := range config.Favorites {
		if mapped, ok := mapRenamedPath(path, oldRel, newRel, isDir); ok {
			config.Favorites[index] = mapped
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return v.writeSidebar(config)
}

func (v *Vault) RemoveFavoritePath(rel string, isDir bool) error {
	v.sidebarMu.Lock()
	defer v.sidebarMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(rel))
	config, err := v.readSidebar()
	if err != nil {
		return err
	}
	kept := config.Favorites[:0]
	for _, path := range config.Favorites {
		if path == rel || (isDir && strings.HasPrefix(path, rel+"/")) {
			continue
		}
		kept = append(kept, path)
	}
	if len(kept) == len(config.Favorites) {
		return nil
	}
	config.Favorites = kept
	return v.writeSidebar(config)
}

func (v *Vault) readSidebar() (sidebarConfig, error) {
	config := sidebarConfig{Favorites: []string{}}
	info, err := os.Lstat(v.sidebarPath())
	if errors.Is(err, os.ErrNotExist) {
		return config, nil
	}
	if err != nil {
		return config, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > 4<<20 {
		return config, errors.New("sidebar metadata is invalid")
	}
	data, err := os.ReadFile(v.sidebarPath())
	if err != nil {
		return config, err
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return sidebarConfig{}, err
	}
	if config.Favorites == nil {
		config.Favorites = []string{}
	}
	seen := map[string]struct{}{}
	cleaned := config.Favorites[:0]
	for _, path := range config.Favorites {
		path = filepath.ToSlash(filepath.Clean(path))
		if path == "." {
			continue
		}
		if _, duplicate := seen[path]; duplicate {
			continue
		}
		seen[path] = struct{}{}
		cleaned = append(cleaned, path)
	}
	config.Favorites = cleaned
	return config, nil
}

func (v *Vault) writeSidebar(config sidebarConfig) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	if info, err := os.Lstat(v.sidebarPath()); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("sidebar metadata cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(v.sidebarPath(), data, 0o644)
}
