package vault

import (
	"embed"
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
	pageTemplatesRel     = ".rockion/templates"
	maxPageTemplateBytes = 1 << 20
	templateTagKey       = "rockion_template_tag"
)

//go:embed default_templates/*.md
var defaultPageTemplates embed.FS

// EnsurePageTemplates creates the vault-local template directory and seeds it
// once. An existing directory is never re-seeded, so deleting a template keeps
// it deleted.
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
		return nil
	case !errors.Is(err, os.ErrNotExist):
		return err
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if _, err := v.resolve(pageTemplatesRel, false); err != nil {
		return err
	}
	entries, err := defaultPageTemplates.ReadDir("default_templates")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
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
	}
	return nil
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
	}
	folder, err := projectName(tag)
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
