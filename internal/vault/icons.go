package vault

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Page icons (emoji) are stored in a sidecar file <vault>/.rockion/icons.json
// mapping vault-relative note path -> emoji. This keeps the .md files untouched
// while the icons still travel with the vault.

func (v *Vault) iconsPath() string {
	return filepath.Join(v.Root, ".rockion", "icons.json")
}

func (v *Vault) ensureMetadataDir() error {
	dir, err := v.resolve(".rockion", true)
	if err != nil {
		return err
	}
	return os.MkdirAll(dir, 0o755)
}

// Icons returns the path→emoji map (empty if none stored yet).
func (v *Vault) Icons() map[string]string {
	v.iconsMu.Lock()
	defer v.iconsMu.Unlock()
	return v.readIcons()
}

func (v *Vault) readIcons() map[string]string {
	m := map[string]string{}
	if info, err := os.Lstat(v.iconsPath()); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || info.Size() > 16<<20 {
			return m
		}
	}
	data, err := os.ReadFile(v.iconsPath())
	if err != nil {
		return m
	}
	_ = json.Unmarshal(data, &m)
	return m
}

// SetIcon sets (or clears, if icon == "") the icon for a note path.
func (v *Vault) SetIcon(rel, icon string) error {
	if _, err := v.Read(rel); err != nil {
		return err
	}
	if err := validateIcon(icon); err != nil {
		return err
	}
	v.iconsMu.Lock()
	defer v.iconsMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(rel))
	m := v.readIcons()
	if icon == "" {
		delete(m, rel)
	} else {
		m[rel] = icon
	}
	return v.writeIcons(m)
}

// RenameIconPath migrates icon keys for a renamed note or every note under a
// renamed folder.
func (v *Vault) RenameIconPath(oldRel, newRel string, isDir bool) error {
	v.iconsMu.Lock()
	defer v.iconsMu.Unlock()
	oldRel = filepath.ToSlash(filepath.Clean(oldRel))
	newRel = filepath.ToSlash(filepath.Clean(newRel))
	m := v.readIcons()
	changed := false
	for path, icon := range m {
		mapped, ok := mapRenamedPath(path, oldRel, newRel, isDir)
		if !ok {
			continue
		}
		delete(m, path)
		m[mapped] = icon
		changed = true
	}
	if !changed {
		return nil
	}
	return v.writeIcons(m)
}

// RemoveIconPath removes icon keys for a deleted note or folder subtree.
func (v *Vault) RemoveIconPath(rel string, isDir bool) error {
	v.iconsMu.Lock()
	defer v.iconsMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(rel))
	m := v.readIcons()
	changed := false
	for path := range m {
		if path == rel || (isDir && strings.HasPrefix(path, rel+"/")) {
			delete(m, path)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return v.writeIcons(m)
}

func (v *Vault) writeIcons(m map[string]string) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	if info, err := os.Lstat(v.iconsPath()); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("icons sidecar cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > 16<<20 {
		return errors.New("icons sidecar exceeds the 16 MB limit")
	}
	return atomicWriteFile(v.iconsPath(), data, 0o644)
}

func mapRenamedPath(path, oldRel, newRel string, isDir bool) (string, bool) {
	if path == oldRel {
		return newRel, true
	}
	if isDir && strings.HasPrefix(path, oldRel+"/") {
		return newRel + strings.TrimPrefix(path, oldRel), true
	}
	return "", false
}

func validateIcon(icon string) error {
	if icon == "" {
		return nil
	}
	const prefix = "data:image/png;base64,"
	if strings.HasPrefix(icon, "data:") {
		if !strings.HasPrefix(icon, prefix) {
			return errors.New("custom icons must be PNG data URLs")
		}
		encoded := strings.TrimPrefix(icon, prefix)
		if len(encoded) > 256<<10 {
			return errors.New("custom icon is too large")
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(raw) == 0 || len(raw) > 192<<10 {
			return errors.New("custom icon data is invalid or too large")
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || format != "png" || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 256 || cfg.Height > 256 {
			return errors.New("custom icon must be a valid PNG no larger than 256x256")
		}
		return nil
	}
	if !utf8.ValidString(icon) || len(icon) > 128 {
		return errors.New("emoji icon is invalid or too long")
	}
	for _, r := range icon {
		if unicode.IsControl(r) {
			return errors.New("emoji icon contains control characters")
		}
	}
	return nil
}
