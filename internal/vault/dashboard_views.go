package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"rockion/internal/model"
)

const (
	viewKey               = "rockion_view"
	sortKey               = "rockion_sort"
	sortDirKey            = "rockion_sort_dir"
	maxDashboardViewsSize = 4 << 20
)

type dashboardViewsConfig struct {
	Dashboards map[string]model.DashboardView `json:"dashboards"`
}

func (v *Vault) dashboardViewsPath() string {
	return filepath.Join(v.Root, ".rockion", "dashboard-views.json")
}

// DashboardView reads the persisted layout config without modifying Markdown.
// Legacy frontmatter keys remain readable so existing vaults retain their view.
func (v *Vault) DashboardView(dashboardRel string) (model.DashboardView, error) {
	dashboardRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(dashboardRel)))
	if !IsDashboardPath(dashboardRel) {
		return model.DashboardView{}, fmt.Errorf("not a dashboard: %s", dashboardRel)
	}
	note, err := v.Read(dashboardRel)
	if err != nil {
		return model.DashboardView{}, err
	}

	v.dashboardViewsMu.Lock()
	defer v.dashboardViewsMu.Unlock()
	config, err := v.readDashboardViews()
	if err != nil {
		return model.DashboardView{}, err
	}
	if view, ok := config.Dashboards[dashboardRel]; ok {
		return normalizeDashboardView(view)
	}

	return normalizeDashboardView(model.DashboardView{
		View:    frontmatterString(note.Frontmatter[viewKey]),
		SortBy:  frontmatterString(note.Frontmatter[sortKey]),
		SortDir: frontmatterString(note.Frontmatter[sortDirKey]),
	})
}

// SetDashboardView persists layout state in Rockion metadata. User frontmatter
// is intentionally left byte-for-byte untouched.
func (v *Vault) SetDashboardView(dashboardRel string, view model.DashboardView) error {
	dashboardRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(dashboardRel)))
	if !IsDashboardPath(dashboardRel) {
		return fmt.Errorf("not a dashboard: %s", dashboardRel)
	}
	if _, err := v.Read(dashboardRel); err != nil {
		return err
	}
	view, err := validateDashboardView(view)
	if err != nil {
		return err
	}

	v.dashboardViewsMu.Lock()
	defer v.dashboardViewsMu.Unlock()
	config, err := v.readDashboardViews()
	if err != nil {
		return err
	}
	config.Dashboards[dashboardRel] = view
	return v.writeDashboardViews(config)
}

func (v *Vault) RenameDashboardViewPath(oldRel, newRel string, isDir bool) error {
	v.dashboardViewsMu.Lock()
	defer v.dashboardViewsMu.Unlock()
	oldRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(oldRel)))
	newRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(newRel)))
	config, err := v.readDashboardViews()
	if err != nil {
		return err
	}
	changed := false
	for path, view := range config.Dashboards {
		mapped, ok := mapRenamedPath(path, oldRel, newRel, isDir)
		if !ok {
			continue
		}
		delete(config.Dashboards, path)
		config.Dashboards[mapped] = view
		changed = true
	}
	if !changed {
		return nil
	}
	return v.writeDashboardViews(config)
}

func (v *Vault) RemoveDashboardViewPath(rel string, isDir bool) error {
	v.dashboardViewsMu.Lock()
	defer v.dashboardViewsMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	config, err := v.readDashboardViews()
	if err != nil {
		return err
	}
	changed := false
	for path := range config.Dashboards {
		if path == rel || (isDir && strings.HasPrefix(path, rel+"/")) {
			delete(config.Dashboards, path)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return v.writeDashboardViews(config)
}

func (v *Vault) readDashboardViews() (dashboardViewsConfig, error) {
	config := dashboardViewsConfig{Dashboards: map[string]model.DashboardView{}}
	info, err := os.Lstat(v.dashboardViewsPath())
	if errors.Is(err, os.ErrNotExist) {
		return config, nil
	}
	if err != nil {
		return config, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		info.Size() > maxDashboardViewsSize {
		return config, errors.New("dashboard view metadata is invalid")
	}
	data, err := os.ReadFile(v.dashboardViewsPath())
	if err != nil {
		return config, err
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return dashboardViewsConfig{}, err
	}
	if config.Dashboards == nil {
		config.Dashboards = map[string]model.DashboardView{}
	}
	cleaned := make(map[string]model.DashboardView, len(config.Dashboards))
	for path, view := range config.Dashboards {
		path = filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
		if path == "." || !IsDashboardPath(path) {
			continue
		}
		normalized, err := validateDashboardView(view)
		if err != nil {
			continue
		}
		cleaned[path] = normalized
	}
	config.Dashboards = cleaned
	return config, nil
}

func (v *Vault) writeDashboardViews(config dashboardViewsConfig) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	if info, err := os.Lstat(v.dashboardViewsPath()); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("dashboard view metadata cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > maxDashboardViewsSize {
		return errors.New("dashboard view metadata exceeds the 4 MB limit")
	}
	return atomicWriteFile(v.dashboardViewsPath(), data, 0o644)
}

func validateDashboardView(view model.DashboardView) (model.DashboardView, error) {
	view.View = strings.TrimSpace(view.View)
	view.SortBy = strings.TrimSpace(view.SortBy)
	view.SortDir = strings.TrimSpace(view.SortDir)
	if view.View == "" {
		view.View = "gallery"
	}
	if view.View != "gallery" && view.View != "list" {
		return model.DashboardView{}, errors.New("dashboard view must be gallery or list")
	}
	switch view.SortBy {
	case "", "title", "created", "modified":
	default:
		return model.DashboardView{}, errors.New("unknown dashboard sort field")
	}
	if view.SortBy == "" {
		view.SortDir = ""
	} else if view.SortDir == "" {
		view.SortDir = "asc"
	} else if view.SortDir != "asc" && view.SortDir != "desc" {
		return model.DashboardView{}, errors.New("dashboard sort direction must be asc or desc")
	}
	return view, nil
}

func normalizeDashboardView(view model.DashboardView) (model.DashboardView, error) {
	normalized, err := validateDashboardView(view)
	if err != nil {
		return model.DashboardView{View: "gallery"}, nil
	}
	return normalized, nil
}

func frontmatterString(value any) string {
	switch value := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(value)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}
