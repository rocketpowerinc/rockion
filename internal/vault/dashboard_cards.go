package vault

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"rockion/internal/model"
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

func managedLineID(line string) string {
	match := managedMarkdownLinkPattern.FindStringSubmatch(line)
	if len(match) != 4 || match[1] == "!" {
		return ""
	}
	return managedIDFromDestination(match[3])
}
