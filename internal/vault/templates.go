package vault

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"rockion/internal/model"
)

const (
	pageTemplatesRel         = ".rockion/templates"
	defaultTemplatesStateRel = ".rockion/default-templates.json"
	maxPageTemplateBytes     = 1 << 20
	maxTemplateStateBytes    = 1 << 20
	templateTagKey           = "rockion_template_tag"
)

//go:embed default_templates/*.md
var defaultPageTemplates embed.FS

type defaultTemplatesState struct {
	Seen []string `json:"seen"`
}

// EnsurePageTemplates creates the vault-local template directory and copies
// each newly bundled default once. A manifest remembers defaults already seen,
// so deleting one from the vault does not cause it to be restored later.
func (v *Vault) EnsurePageTemplates() error {
	dir, err := v.resolve(pageTemplatesRel, true)
	if err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	switch {
	case err == nil:
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("page templates directory cannot be a symlink")
		}
		if !info.IsDir() {
			return errors.New("page templates path is not a directory")
		}
	case !errors.Is(err, os.ErrNotExist):
		return err
	default:
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	if _, err := v.resolve(pageTemplatesRel, false); err != nil {
		return err
	}
	state, err := v.readDefaultTemplatesState()
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(state.Seen))
	for _, name := range state.Seen {
		seen[name] = true
	}
	entries, err := defaultPageTemplates.ReadDir("default_templates")
	if err != nil {
		return err
	}
	changed := false
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			continue
		}
		if seen[entry.Name()] {
			continue
		}
		content, err := defaultPageTemplates.ReadFile("default_templates/" + entry.Name())
		if err != nil {
			return err
		}
		if err := createFileExclusive(
			filepath.Join(dir, entry.Name()),
			content,
			0o644,
		); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		seen[entry.Name()] = true
		changed = true
	}
	if changed || len(state.Seen) == 0 {
		state.Seen = make([]string, 0, len(seen))
		for name := range seen {
			state.Seen = append(state.Seen, name)
		}
		sort.SliceStable(state.Seen, func(i, j int) bool {
			return strings.ToLower(state.Seen[i]) < strings.ToLower(state.Seen[j])
		})
		if err := v.writeDefaultTemplatesState(state); err != nil {
			return err
		}
	}
	return nil
}

func (v *Vault) readDefaultTemplatesState() (defaultTemplatesState, error) {
	state := defaultTemplatesState{Seen: []string{}}
	full, err := v.resolve(defaultTemplatesStateRel, true)
	if err != nil {
		return state, err
	}
	info, err := os.Lstat(full)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return state, errors.New("default template manifest must be a regular file")
	}
	if info.Size() > maxTemplateStateBytes {
		return state, errors.New("default template manifest exceeds the 1 MB limit")
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, fmt.Errorf("read default template manifest: %w", err)
	}
	if state.Seen == nil {
		state.Seen = []string{}
	}
	return state, nil
}

func (v *Vault) writeDefaultTemplatesState(state defaultTemplatesState) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > maxTemplateStateBytes {
		return errors.New("default template manifest exceeds the 1 MB limit")
	}
	full, err := v.resolve(defaultTemplatesStateRel, true)
	if err != nil {
		return err
	}
	return atomicWriteFile(full, data, 0o644)
}

// PageTemplates lists the current .md files from the vault template directory.
// It reads the directory on every call so external additions and removals are
// reflected the next time the New Page dialog opens.
func (v *Vault) PageTemplates() ([]model.PageTemplate, error) {
	if err := v.EnsurePageTemplates(); err != nil {
		return nil, err
	}
	dir, err := v.resolve(pageTemplatesRel, false)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	templates := make([]model.PageTemplate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() ||
			entry.Type()&os.ModeSymlink != 0 ||
			strings.HasPrefix(entry.Name(), ".") ||
			!strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxPageTemplateBytes {
			continue
		}
		templates = append(templates, model.PageTemplate{
			ID:    entry.Name(),
			Label: strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())),
		})
	}
	sort.SliceStable(templates, func(i, j int) bool {
		return strings.ToLower(templates[i].Label) < strings.ToLower(templates[j].Label)
	})
	return templates, nil
}

func (v *Vault) renderPageTemplate(name, title, id, created string) ([]byte, error) {
	tag := templateTag(name)
	if name == "" {
		return []byte(managedFrontmatter(id, created, tag, "\n") + "# " + title + "\n\n"), nil
	}
	if filepath.Base(name) != name ||
		strings.ContainsAny(name, `/\`) ||
		strings.HasPrefix(name, ".") ||
		!strings.EqualFold(filepath.Ext(name), ".md") {
		return nil, errors.New("invalid page template filename")
	}
	if err := v.EnsurePageTemplates(); err != nil {
		return nil, err
	}
	templateRel := filepath.ToSlash(filepath.Join(pageTemplatesRel, name))
	full, err := v.resolve(templateRel, false)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("page template must be a regular file")
	}
	if info.Size() > maxPageTemplateBytes {
		return nil, fmt.Errorf("page template exceeds the %d byte limit", maxPageTemplateBytes)
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	rendered := strings.ReplaceAll(string(raw), "{{title}}", title)
	rendered = strings.ReplaceAll(rendered, "{{ title }}", title)

	fm, header, body := splitFrontmatter(rendered)
	if strings.HasPrefix(rendered, "---\n") || strings.HasPrefix(rendered, "---\r\n") {
		if header == "" {
			return nil, errors.New("page template has invalid YAML frontmatter")
		}
		for key := range fm {
			if strings.EqualFold(key, "rockion_id") ||
				strings.EqualFold(key, "rockion_created") ||
				strings.EqualFold(key, templateTagKey) {
				return nil, fmt.Errorf("page template cannot define reserved property %q", key)
			}
		}
		header = templateTitleFrontmatterPattern.ReplaceAllStringFunc(
			header,
			func(string) string { return "title: " + strconv.Quote(title) },
		)
	}
	body = applyTemplatePageTitle(body, title)

	if header == "" {
		return []byte(managedFrontmatter(id, created, tag, "\n") + body), nil
	}
	firstEnd := strings.IndexByte(header, '\n') + 1
	if firstEnd <= 0 {
		return nil, errors.New("page template frontmatter is malformed")
	}
	newline := "\n"
	if strings.HasSuffix(header[:firstEnd], "\r\n") {
		newline = "\r\n"
	}
	managed := "rockion_id: " + id + newline +
		"rockion_created: " + created + newline +
		templateTagKey + ": " + strconv.Quote(tag) + newline
	return []byte(header[:firstEnd] + managed + header[firstEnd:] + body), nil
}

func managedFrontmatter(id, created, tag, newline string) string {
	return "---" + newline +
		"rockion_id: " + id + newline +
		"rockion_created: " + created + newline +
		templateTagKey + ": " + strconv.Quote(tag) + newline +
		"---" + newline
}

func templateTag(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Other"
	}
	label := strings.TrimSpace(strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)))
	switch normalizeTemplateTag(label) {
	case "", "blank", "other":
		return "Other"
	case "cheatsheet", "cheatsheets", "cheetsheet", "cheetsheets":
		return "Cheatsheet"
	case "prepper":
		return "Prepper"
	case "kids":
		return "Kids"
	case "health":
		return "Health"
	case "education":
		return "Education"
	case "gaming":
		return "Gaming"
	case "homelab":
		return "Homelab"
	case "bookmarks":
		return "Bookmarks"
	}
	return label
}

func templateTagColor(tag string) string {
	normalized := normalizeTemplateTag(tag)
	switch normalized {
	case "", "other", "blank":
		return "gray"
	case "bootstrap", "bootstraps":
		return "green"
	case "cheatsheet", "cheatsheets", "cheetsheet", "cheetsheets":
		return "pink"
	case "prepper":
		return "orange"
	case "kids":
		return "yellow"
	case "health":
		return "purple"
	case "education":
		return "red"
	case "gaming":
		return "cyan"
	case "homelab":
		return "blue"
	case "bookmarks":
		return "lime"
	}
	palette := [...]string{"cyan", "yellow", "purple", "orange", "blue", "lime", "magenta"}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(normalized))
	return palette[int(hash.Sum32())%len(palette)]
}

func templateTagFolder(tag string) (string, error) {
	switch normalizeTemplateTag(tag) {
	case "", "blank", "other":
		return "Other", nil
	case "bootstrap", "bootstraps":
		return "Bootstraps", nil
	case "cheatsheet", "cheatsheets", "cheetsheet", "cheetsheets":
		return "Cheatsheets", nil
	case "prepper":
		return "Prepper", nil
	case "kids":
		return "Kids", nil
	case "health":
		return "Health", nil
	case "education":
		return "Education", nil
	case "gaming":
		return "Gaming", nil
	case "homelab":
		return "Homelab", nil
	case "bookmarks":
		return "Bookmarks", nil
	}
	folder, err := ProjectName(tag)
	if err != nil {
		return "", fmt.Errorf("invalid template tag folder: %w", err)
	}
	return folder, nil
}

func normalizeTemplateTag(tag string) string {
	return strings.ToLower(strings.NewReplacer(
		" ", "",
		"-", "",
		"_", "",
	).Replace(strings.TrimSpace(tag)))
}

func applyTemplatePageTitle(body, title string) string {
	replacement := "# " + title
	if templatePageTitlePattern.MatchString(body) {
		return templatePageTitlePattern.ReplaceAllStringFunc(
			body,
			func(string) string { return replacement },
		)
	}
	return replacement + "\n\n" + strings.TrimLeft(body, "\r\n")
}
