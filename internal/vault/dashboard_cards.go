package vault

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"rockion/internal/model"
)

const (
	viewKey    = "rockion_view"
	sortKey    = "rockion_sort"
	sortDirKey = "rockion_sort_dir"
)

// DashboardCards returns the managed pages of a dashboard as gallery cards, in
// the dashboard's current link order. Card data is derived from each page file
// plus its sidecar icon/cover, so nothing card-specific is written to disk.
func (v *Vault) DashboardCards(dashboardRel string) ([]model.PageCard, error) {
	dashboardRel = filepath.ToSlash(filepath.Clean(dashboardRel))
	if !IsDashboardPath(dashboardRel) {
		return nil, fmt.Errorf("not a dashboard: %s", dashboardRel)
	}
	dashboard, err := v.Read(dashboardRel)
	if err != nil {
		return nil, err
	}
	dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(dashboardRel)))
	pages, err := v.managedPages(dir)
	if err != nil {
		return nil, err
	}
	icons := v.Icons()

	cards := make([]model.PageCard, 0, len(pages))
	seen := map[string]bool{}
	add := func(note model.Note) {
		if note.PageID == "" || seen[note.PageID] {
			return
		}
		seen[note.PageID] = true
		cards = append(cards, model.PageCard{
			PageID:     note.PageID,
			Path:       note.Path,
			Title:      managedTitle(note),
			Icon:       icons[note.Path],
			Cover:      v.Cover(note.Path),
			CreatedAt:  note.CreatedAt,
			ModifiedAt: note.ModifiedAt,
		})
	}

	// Cards follow the order of the managed links in the dashboard body.
	for _, match := range managedMarkdownLinkPattern.FindAllStringSubmatch(dashboard.Markdown, -1) {
		if len(match) != 4 || match[1] == "!" {
			continue
		}
		id := managedIDFromDestination(match[3])
		if id == "" {
			continue
		}
		if page, ok := pages[id]; ok {
			add(page)
		}
	}
	// Any page not yet linked is appended alphabetically (mirrors normalizeDashboard).
	remaining := make([]model.Note, 0)
	for _, page := range pages {
		if !seen[page.PageID] {
			remaining = append(remaining, page)
		}
	}
	sort.Slice(remaining, func(i, j int) bool {
		return strings.ToLower(managedTitle(remaining[i])) < strings.ToLower(managedTitle(remaining[j]))
	})
	for _, page := range remaining {
		add(page)
	}
	return cards, nil
}

// DashboardView reads the persisted layout config from a dashboard's frontmatter.
func (v *Vault) DashboardView(dashboardRel string) (model.DashboardView, error) {
	note, err := v.Read(dashboardRel)
	if err != nil {
		return model.DashboardView{}, err
	}
	view := model.DashboardView{
		View:    frontmatterString(note.Frontmatter[viewKey]),
		SortBy:  frontmatterString(note.Frontmatter[sortKey]),
		SortDir: frontmatterString(note.Frontmatter[sortDirKey]),
	}
	if view.View == "" {
		view.View = "gallery"
	}
	return view, nil
}

// SetDashboardView persists the layout config into the dashboard's frontmatter.
func (v *Vault) SetDashboardView(dashboardRel string, view model.DashboardView) error {
	note, err := v.Read(dashboardRel)
	if err != nil {
		return err
	}
	return v.mutateFrontmatter(dashboardRel, note.Version, func(fm map[string]any) {
		setOrDelete(fm, viewKey, view.View)
		setOrDelete(fm, sortKey, view.SortBy)
		setOrDelete(fm, sortDirKey, view.SortDir)
	})
}

// ReorderManagedPages rewrites the order of managed links in the dashboard body
// to match ids, leaving non-managed lines in place.
func (v *Vault) ReorderManagedPages(dashboardRel string, ids []string) error {
	dashboardRel = filepath.ToSlash(filepath.Clean(dashboardRel))
	if !IsDashboardPath(dashboardRel) {
		return fmt.Errorf("not a dashboard: %s", dashboardRel)
	}
	dashboard, err := v.Read(dashboardRel)
	if err != nil {
		return err
	}
	lines := strings.Split(dashboard.Markdown, "\n")
	var slots []int
	lineByID := map[string]string{}
	var order []string
	for i, line := range lines {
		id := managedLineID(line)
		if id == "" {
			continue
		}
		slots = append(slots, i)
		lineByID[id] = line
		order = append(order, id)
	}
	if len(slots) == 0 {
		return nil
	}
	desired := make([]string, 0, len(slots))
	seen := map[string]bool{}
	for _, id := range ids {
		if _, ok := lineByID[id]; ok && !seen[id] {
			desired = append(desired, id)
			seen[id] = true
		}
	}
	for _, id := range order {
		if !seen[id] {
			desired = append(desired, id)
			seen[id] = true
		}
	}
	for k, slotIdx := range slots {
		lines[slotIdx] = lineByID[desired[k]]
	}
	updated := strings.Join(lines, "\n")
	if updated == dashboard.Markdown {
		return nil
	}
	return v.WriteExpected(dashboardRel, updated, dashboard.Version)
}

// --- helpers ---

func (v *Vault) mutateFrontmatter(rel, expectedVersion string, mutate func(map[string]any)) error {
	full, err := v.resolve(rel, false)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return err
	}
	fm, _, body := splitFrontmatter(string(raw))
	if fm == nil {
		fm = map[string]any{}
	}
	mutate(fm)
	header := ""
	if len(fm) > 0 {
		out, err := yaml.Marshal(fm)
		if err != nil {
			return err
		}
		header = "---\n" + string(out) + "---\n"
	}
	return atomicWriteFileChecked(full, []byte(header+body), 0o644, expectedVersion)
}

func managedLineID(line string) string {
	match := managedMarkdownLinkPattern.FindStringSubmatch(line)
	if len(match) != 4 || match[1] == "!" {
		return ""
	}
	return managedIDFromDestination(match[3])
}

func setOrDelete(fm map[string]any, key, value string) {
	if strings.TrimSpace(value) == "" {
		delete(fm, key)
		return
	}
	fm[key] = value
}

func frontmatterString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case bool:
		return fmt.Sprintf("%t", v)
	case int, int64, float64:
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
}
