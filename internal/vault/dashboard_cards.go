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

// cardPropertyKeys are the lightweight frontmatter fields surfaced as editable
// chips on pages and cards. Everything else in frontmatter is left untouched.
var cardPropertyKeys = []string{"status", "priority", "date", "tags"}

const (
	viewKey        = "rockion_view"
	groupKey       = "rockion_group"
	sortKey        = "rockion_sort"
	sortDirKey     = "rockion_sort_dir"
	filterKeyKey   = "rockion_filter_key"
	filterValueKey = "rockion_filter_value"
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
		done, total := todoCounts(note.Markdown)
		cards = append(cards, model.PageCard{
			PageID:     note.PageID,
			Path:       note.Path,
			Title:      managedTitle(note),
			Icon:       icons[note.Path],
			Cover:      v.Cover(note.Path),
			Excerpt:    pageExcerpt(note.Markdown),
			ModifiedAt: note.ModifiedAt,
			Properties: cardProperties(note.Frontmatter),
			TodoDone:   done,
			TodoTotal:  total,
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
		View:        frontmatterString(note.Frontmatter[viewKey]),
		GroupBy:     frontmatterString(note.Frontmatter[groupKey]),
		SortBy:      frontmatterString(note.Frontmatter[sortKey]),
		SortDir:     frontmatterString(note.Frontmatter[sortDirKey]),
		FilterKey:   frontmatterString(note.Frontmatter[filterKeyKey]),
		FilterValue: frontmatterString(note.Frontmatter[filterValueKey]),
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
		setOrDelete(fm, groupKey, view.GroupBy)
		setOrDelete(fm, sortKey, view.SortBy)
		setOrDelete(fm, sortDirKey, view.SortDir)
		setOrDelete(fm, filterKeyKey, view.FilterKey)
		setOrDelete(fm, filterValueKey, view.FilterValue)
	})
}

// SetPageProperty sets (or clears, when value is empty) a recognized frontmatter
// property on a page. "tags" is stored as a YAML list; the rest as scalars.
func (v *Vault) SetPageProperty(pageRel, key, value string) error {
	key = strings.ToLower(strings.TrimSpace(key))
	if !isCardPropertyKey(key) {
		return fmt.Errorf("unsupported property: %s", key)
	}
	note, err := v.Read(pageRel)
	if err != nil {
		return err
	}
	value = strings.TrimSpace(value)
	return v.mutateFrontmatter(pageRel, note.Version, func(fm map[string]any) {
		if key == "tags" {
			tags := splitTags(value)
			if len(tags) == 0 {
				delete(fm, "tags")
			} else {
				fm["tags"] = tags
			}
			return
		}
		setOrDelete(fm, key, value)
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

func cardProperties(fm map[string]any) map[string]string {
	if fm == nil {
		return nil
	}
	props := map[string]string{}
	for _, key := range []string{"status", "priority", "date"} {
		if s := frontmatterString(fm[key]); s != "" {
			props[key] = s
		}
	}
	if tags := frontmatterTags(fm["tags"]); tags != "" {
		props["tags"] = tags
	}
	if len(props) == 0 {
		return nil
	}
	return props
}

func pageExcerpt(body string) string {
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Strip a leading list/quote/todo marker.
		line = strings.TrimLeft(line, ">*+-0123456789. ")
		line = strings.TrimPrefix(line, "[ ] ")
		line = strings.TrimPrefix(line, "[x] ")
		line = strings.TrimPrefix(line, "[X] ")
		// Turn [label](url) into label and drop basic emphasis characters.
		line = managedMarkdownLinkPattern.ReplaceAllString(line, "$2")
		line = strings.NewReplacer("**", "", "__", "", "`", "").Replace(line)
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		runes := []rune(line)
		if len(runes) > 160 {
			return strings.TrimSpace(string(runes[:160])) + "…"
		}
		return line
	}
	return ""
}

func todoCounts(body string) (done, total int) {
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		line = strings.TrimLeft(line, "*+- ")
		switch {
		case strings.HasPrefix(line, "[ ]"):
			total++
		case strings.HasPrefix(line, "[x]"), strings.HasPrefix(line, "[X]"):
			total++
			done++
		}
	}
	return done, total
}

func isCardPropertyKey(key string) bool {
	for _, k := range cardPropertyKeys {
		if k == key {
			return true
		}
	}
	return false
}

func setOrDelete(fm map[string]any, key, value string) {
	if strings.TrimSpace(value) == "" {
		delete(fm, key)
		return
	}
	fm[key] = value
}

func splitTags(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
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

func frontmatterTags(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if s := frontmatterString(item); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ", ")
	case []string:
		return strings.Join(v, ", ")
	case string:
		return strings.TrimSpace(v)
	default:
		return frontmatterString(value)
	}
}
