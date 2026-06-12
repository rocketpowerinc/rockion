package vault

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Page icons (emoji) are stored in a sidecar file <vault>/.rockion/icons.json
// mapping vault-relative note path -> emoji. This keeps the .md files untouched
// while the icons still travel with the vault.

func (v *Vault) iconsPath() string {
	return filepath.Join(v.Root, ".rockion", "icons.json")
}

// Icons returns the path→emoji map (empty if none stored yet).
func (v *Vault) Icons() map[string]string {
	m := map[string]string{}
	data, err := os.ReadFile(v.iconsPath())
	if err != nil {
		return m
	}
	_ = json.Unmarshal(data, &m)
	return m
}

// SetIcon sets (or clears, if icon == "") the icon for a note path.
func (v *Vault) SetIcon(rel, icon string) error {
	rel = filepath.ToSlash(rel)
	m := v.Icons()
	if icon == "" {
		delete(m, rel)
	} else {
		m[rel] = icon
	}
	if err := os.MkdirAll(filepath.Join(v.Root, ".rockion"), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(v.iconsPath(), data, 0o644)
}
