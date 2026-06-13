package vault

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"rockion/internal/model"
)

const managedPageQuery = "rockion-page"

var managedMarkdownLinkPattern = regexp.MustCompile(`(!?)\[([^\]]*)\]\(([^)]+)\)`)
var pageIDFrontmatterPattern = regexp.MustCompile(`(?m)^rockion_id[ \t]*:[^\r\n]*(\r?)$`)

type ManagedDeleteResult struct {
	Dashboard   model.Note
	DeletedPath string
}

func IsDashboardPath(path string) bool {
	return strings.EqualFold(filepath.Base(filepath.FromSlash(path)), "dashboard.md")
}

// EnsureManagedDashboards migrates existing project pages to stable IDs and
// makes every project dashboard the authoritative entry point for those pages.
func (v *Vault) EnsureManagedDashboards() error {
	entries, err := os.ReadDir(v.Root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || sidebarHidden(entry.Name()) {
			continue
		}
		dashboard, err := v.dashboardPath(entry.Name())
		if err != nil {
			return err
		}
		if _, err := v.normalizeDashboard(dashboard, ""); err != nil {
			return err
		}
	}
	return nil
}

func (v *Vault) NormalizeManagedDashboard(path string) (bool, error) {
	if !IsDashboardPath(path) {
		return false, nil
	}
	return v.normalizeDashboard(filepath.ToSlash(filepath.Clean(path)), "")
}

// CreateManagedPage creates a stable-ID page beside a project dashboard.
func (v *Vault) CreateManagedPage(dashboardRel, title string) (model.Note, error) {
	return v.CreateManagedPageFromTemplate(dashboardRel, title, "")
}

// CreateManagedPageFromTemplate creates a stable-ID page seeded from a built-in
// template (status defaults, a meeting layout, etc.). An empty template id makes
// a blank page.
func (v *Vault) CreateManagedPageFromTemplate(dashboardRel, title, template string) (model.Note, error) {
	dashboardRel = filepath.ToSlash(filepath.Clean(dashboardRel))
	if !IsDashboardPath(dashboardRel) || filepath.Dir(filepath.FromSlash(dashboardRel)) == "." {
		return model.Note{}, errors.New("new sub-pages must be created from a project dashboard")
	}
	if _, err := v.Read(dashboardRel); err != nil {
		return model.Note{}, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return model.Note{}, errors.New("page title is required")
	}
	name := sanitize(title) + ".md"
	rel := filepath.ToSlash(filepath.Join(filepath.Dir(filepath.FromSlash(dashboardRel)), name))
	if err := requireUserPath(rel); err != nil {
		return model.Note{}, err
	}
	full, err := v.resolve(rel, true)
	if err != nil {
		return model.Note{}, err
	}
	id, err := newPageID()
	if err != nil {
		return model.Note{}, err
	}
	props, body := managedTemplate(template, title)
	front := "rockion_id: " + id + "\n"
	keys := make([]string, 0, len(props))
	for k := range props {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		front += k + ": " + props[k] + "\n"
	}
	content := []byte("---\n" + front + "---\n" + body)
	if err := createFileExclusive(full, content, 0o644); err != nil {
		if errors.Is(err, os.ErrExist) {
			return model.Note{}, fmt.Errorf("note already exists: %s", rel)
		}
		return model.Note{}, err
	}
	return v.Read(rel)
}

// managedTemplate returns seed frontmatter properties + body for a template id.
func managedTemplate(template, title string) (map[string]string, string) {
	switch template {
	case "meeting":
		return nil, fmt.Sprintf(
			"# %s\n\n**Date:** \n**Attendees:** \n\n## Agenda\n\n- \n\n## Notes\n\n\n## Action items\n\n- [ ] \n",
			title,
		)
	case "task":
		return map[string]string{"status": "To do", "priority": "Medium"},
			fmt.Sprintf("# %s\n\n## Subtasks\n\n- [ ] \n", title)
	default:
		return nil, fmt.Sprintf("# %s\n\n", title)
	}
}

// NormalizeDashboardForPage updates a page's managed dashboard link after a
// title or filename change.
func (v *Vault) NormalizeDashboardForPage(pageRel string) (string, bool, error) {
	pageRel = filepath.ToSlash(filepath.Clean(pageRel))
	dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(pageRel)))
	if dir == "." || IsDashboardPath(pageRel) {
		return "", false, nil
	}
	dashboard, err := v.dashboardPath(dir)
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	changed, err := v.normalizeDashboard(dashboard, "")
	return dashboard, changed, err
}

// DeleteManagedPage removes a page and its managed dashboard entry together.
func (v *Vault) DeleteManagedPage(
	dashboardRel, href, expectedVersion string,
) (ManagedDeleteResult, error) {
	dashboardRel = filepath.ToSlash(filepath.Clean(dashboardRel))
	if !IsDashboardPath(dashboardRel) {
		return ManagedDeleteResult{}, errors.New("managed pages can only be deleted from a dashboard")
	}
	dashboard, err := v.Read(dashboardRel)
	if err != nil {
		return ManagedDeleteResult{}, err
	}
	if expectedVersion != "" && dashboard.Version != expectedVersion {
		return ManagedDeleteResult{}, ErrConflict
	}
	id := managedIDFromDestination(href)
	if id == "" {
		return ManagedDeleteResult{}, errors.New("link is not a managed page")
	}
	dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(dashboardRel)))
	pages, err := v.managedPages(dir)
	if err != nil {
		return ManagedDeleteResult{}, err
	}
	target, ok := pages[id]
	if !ok {
		return ManagedDeleteResult{}, errors.New("managed page no longer exists")
	}
	targetFull, err := v.resolve(target.Path, false)
	if err != nil {
		return ManagedDeleteResult{}, err
	}
	trash := targetFull + ".rockion-delete-" + id
	if err := os.Rename(targetFull, trash); err != nil {
		return ManagedDeleteResult{}, err
	}
	restore := true
	defer func() {
		if restore {
			_ = os.Rename(trash, targetFull)
		}
	}()

	updated := removeManagedLink(dashboard.Markdown, id)
	if updated == dashboard.Markdown {
		return ManagedDeleteResult{}, errors.New("managed dashboard link was not found")
	}
	if err := v.WriteExpected(dashboardRel, updated, dashboard.Version); err != nil {
		return ManagedDeleteResult{}, err
	}
	if err := os.Remove(trash); err != nil {
		refreshed, readErr := v.Read(dashboardRel)
		var rollbackErr error
		if readErr == nil {
			rollbackErr = v.WriteExpected(dashboardRel, dashboard.Markdown, refreshed.Version)
		}
		return ManagedDeleteResult{}, errors.Join(err, readErr, rollbackErr)
	}
	restore = false
	refreshed, err := v.Read(dashboardRel)
	if err != nil {
		return ManagedDeleteResult{}, err
	}
	return ManagedDeleteResult{Dashboard: refreshed, DeletedPath: target.Path}, nil
}

func (v *Vault) normalizeDashboard(dashboardRel, expectedVersion string) (bool, error) {
	dashboard, err := v.Read(dashboardRel)
	if err != nil {
		return false, err
	}
	if expectedVersion != "" && dashboard.Version != expectedVersion {
		return false, ErrConflict
	}
	dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(dashboardRel)))
	pages, err := v.managedPages(dir)
	if err != nil {
		return false, err
	}
	seen := map[string]bool{}
	updated := managedMarkdownLinkPattern.ReplaceAllStringFunc(
		dashboard.Markdown,
		func(match string) string {
			parts := managedMarkdownLinkPattern.FindStringSubmatch(match)
			if len(parts) != 4 || parts[1] == "!" {
				return match
			}
			id := managedIDFromDestination(parts[3])
			if id == "" {
				target := resolveMarkdownTarget(dashboardRel, parts[3])
				for pageID, page := range pages {
					if page.Path == target {
						id = pageID
						break
					}
				}
			}
			page, ok := pages[id]
			if !ok {
				if id != "" {
					return ""
				}
				return match
			}
			if seen[id] {
				return ""
			}
			seen[id] = true
			label := managedTitle(page)
			previousAutoTitle := managedAutoTitle(parts[3])
			if (previousAutoTitle != "" && parts[2] != previousAutoTitle) ||
				(previousAutoTitle == "" && parts[2] != "" && parts[2] != label) {
				label = parts[2]
			}
			return managedLink(dashboardRel, page, label)
		},
	)

	missing := make([]model.Note, 0)
	for id, page := range pages {
		if !seen[id] {
			missing = append(missing, page)
		}
	}
	sort.Slice(missing, func(i, j int) bool {
		return strings.ToLower(managedTitle(missing[i])) < strings.ToLower(managedTitle(missing[j]))
	})
	if len(missing) > 0 {
		updated = strings.TrimRight(updated, "\n") + "\n\n"
		for _, page := range missing {
			updated += "- " + managedLink(dashboardRel, page, managedTitle(page)) + "\n"
		}
	}
	if updated == dashboard.Markdown {
		return false, nil
	}
	if err := v.WriteExpected(dashboardRel, updated, dashboard.Version); err != nil {
		return false, err
	}
	return true, nil
}

func (v *Vault) managedPages(dir string) (map[string]model.Note, error) {
	full, err := v.resolve(dir, false)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(full)
	if err != nil {
		return nil, err
	}
	pages := map[string]model.Note{}
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 ||
			!IsMarkdownPath(entry.Name()) || strings.EqualFold(entry.Name(), "dashboard.md") {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(dir, entry.Name()))
		note, err := v.ensurePageID(rel)
		if err != nil {
			return nil, err
		}
		if _, duplicate := pages[note.PageID]; duplicate {
			note, err = v.replacePageID(rel, note)
			if err != nil {
				return nil, err
			}
		}
		pages[note.PageID] = note
	}
	return pages, nil
}

func (v *Vault) ensurePageID(rel string) (model.Note, error) {
	note, err := v.Read(rel)
	if err != nil {
		return model.Note{}, err
	}
	if note.PageID != "" {
		return note, nil
	}
	id, err := newPageID()
	if err != nil {
		return model.Note{}, err
	}
	full, err := v.resolve(rel, false)
	if err != nil {
		return model.Note{}, err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return model.Note{}, err
	}
	_, header, body := splitFrontmatter(string(raw))
	var updated string
	if header == "" {
		updated = fmt.Sprintf("---\nrockion_id: %s\n---\n%s", id, body)
	} else {
		closeAt := strings.LastIndex(header, "---")
		if closeAt < 0 {
			closeAt = strings.LastIndex(header, "...")
		}
		if closeAt < 0 {
			return model.Note{}, errors.New("could not update page frontmatter")
		}
		updated = header[:closeAt] + "rockion_id: " + id + "\n" + header[closeAt:] + body
	}
	if err := atomicWriteFileChecked(full, []byte(updated), 0o644, note.Version); err != nil {
		return model.Note{}, err
	}
	return v.Read(rel)
}

func (v *Vault) replacePageID(rel string, note model.Note) (model.Note, error) {
	id, err := newPageID()
	if err != nil {
		return model.Note{}, err
	}
	full, err := v.resolve(rel, false)
	if err != nil {
		return model.Note{}, err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return model.Note{}, err
	}
	_, header, body := splitFrontmatter(string(raw))
	if header == "" || !pageIDFrontmatterPattern.MatchString(header) {
		return model.Note{}, errors.New("could not replace duplicate page ID")
	}
	header = pageIDFrontmatterPattern.ReplaceAllStringFunc(header, func(line string) string {
		newline := ""
		if strings.HasSuffix(line, "\r") {
			newline = "\r"
		}
		return "rockion_id: " + id + newline
	})
	if err := atomicWriteFileChecked(full, []byte(header+body), 0o644, note.Version); err != nil {
		return model.Note{}, err
	}
	return v.Read(rel)
}

func managedLink(sourceRel string, page model.Note, label string) string {
	relative, err := filepath.Rel(
		filepath.Dir(filepath.FromSlash(sourceRel)),
		filepath.FromSlash(page.Path),
	)
	if err != nil {
		relative = filepath.Base(filepath.FromSlash(page.Path))
	}
	escaped := strings.ReplaceAll(filepath.ToSlash(relative), " ", "%20")
	query := url.Values{}
	query.Set(managedPageQuery, page.PageID)
	query.Set("rockion-title", managedTitle(page))
	return fmt.Sprintf("[%s](%s?%s)", label, escaped, query.Encode())
}

func managedTitle(note model.Note) string {
	for _, line := range strings.Split(note.Markdown, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(line[2:])
		}
	}
	return note.Title
}

func managedIDFromDestination(destination string) string {
	raw, _ := splitMarkdownDestination(destination)
	raw = strings.Trim(raw, "<>")
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Query().Get(managedPageQuery)
}

func managedAutoTitle(destination string) string {
	raw, _ := splitMarkdownDestination(destination)
	raw = strings.Trim(raw, "<>")
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("rockion-title")
}

func resolveMarkdownTarget(sourceRel, destination string) string {
	raw, _ := splitMarkdownDestination(destination)
	raw = strings.Trim(raw, "<>")
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" {
		return ""
	}
	decoded, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(filepath.Clean(filepath.Join(
		filepath.Dir(filepath.FromSlash(sourceRel)),
		filepath.FromSlash(decoded),
	)))
}

func removeManagedLink(markdown, id string) string {
	updated := managedMarkdownLinkPattern.ReplaceAllStringFunc(markdown, func(match string) string {
		parts := managedMarkdownLinkPattern.FindStringSubmatch(match)
		if len(parts) == 4 && parts[1] != "!" && managedIDFromDestination(parts[3]) == id {
			return ""
		}
		return match
	})
	return regexp.MustCompile(`(?m)^[ \t]*[-*+][ \t]*\r?\n`).ReplaceAllString(updated, "")
}

func newPageID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" +
		encoded[16:20] + "-" + encoded[20:], nil
}
