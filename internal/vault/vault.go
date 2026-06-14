package vault

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"gopkg.in/yaml.v3"

	"rockion/internal/model"
)

var ErrConflict = errors.New("note changed on disk")

const maxNoteBytes = 32 << 20

// Vault is an opened folder of markdown files.
type Vault struct {
	Root             string
	iconsMu          sync.Mutex
	coversMu         sync.Mutex
	sidebarMu        sync.Mutex
	dashboardViewsMu sync.Mutex
}

// Open returns a Vault rooted at an existing directory.
func Open(root string) (*Vault, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	linkInfo, err := os.Lstat(absolute)
	if err != nil {
		return nil, err
	}
	if linkInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("vault root cannot be a symlink")
	}
	if !linkInfo.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	return &Vault{Root: filepath.Clean(absolute)}, nil
}

func (v *Vault) Info() model.VaultInfo {
	return model.VaultInfo{Path: v.Root, Name: filepath.Base(v.Root)}
}

// resolve resolves a non-root vault-relative path and rejects traversal through
// symlinks. allowMissing permits a new final path, but every existing parent
// component must still be a real directory inside the vault.
func (v *Vault) resolve(rel string, allowMissing bool) (string, error) {
	if strings.TrimSpace(rel) == "" || filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" {
		return "", errors.New("invalid vault-relative path")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || clean == string(filepath.Separator) {
		return "", errors.New("vault root is not a valid target")
	}
	full := filepath.Join(v.Root, clean)
	inside, err := filepath.Rel(v.Root, full)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes vault")
	}

	current := v.Root
	parts := strings.Split(inside, string(filepath.Separator))
	for i, part := range parts {
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if statErr != nil {
			if errors.Is(statErr, os.ErrNotExist) && allowMissing {
				break
			}
			return "", statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symlink paths are not allowed: %s", rel)
		}
		if i < len(parts)-1 && !info.IsDir() {
			return "", fmt.Errorf("path component is not a directory: %s", part)
		}
	}
	return full, nil
}

func requireMarkdownPath(rel string) error {
	if !IsMarkdownPath(rel) {
		return fmt.Errorf("not a supported markdown file: %s", rel)
	}
	return nil
}

func requireUserPath(rel string) error {
	clean := filepath.Clean(filepath.FromSlash(rel))
	for _, part := range strings.Split(clean, string(filepath.Separator)) {
		if strings.HasPrefix(part, ".") || strings.EqualFold(part, "node_modules") {
			return fmt.Errorf("protected vault path: %s", rel)
		}
	}
	return nil
}

// hidden reports whether a path component should be skipped in the tree.
func hidden(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules"
}

// maxTreeDepth caps recursion to avoid a fatal stack overflow on pathological
// vaults (e.g. a directory junction/symlink that loops back on itself).
const maxTreeDepth = 32

// Tree builds the sidebar tree of folders and .md files.
func (v *Vault) Tree() ([]model.TreeNode, error) {
	return v.readDir(v.Root, 0, v.Icons())
}

// SidebarTree returns root folders and loose root notes. Folder children are
// intentionally omitted: their dashboard is the navigation entry point.
func (v *Vault) SidebarTree() ([]model.TreeNode, error) {
	if err := v.EnsureRootDashboards(); err != nil {
		return nil, err
	}
	icons := v.Icons()
	entries, err := os.ReadDir(v.Root)
	if err != nil {
		return nil, err
	}
	nodes := []model.TreeNode{}
	for _, entry := range entries {
		if sidebarHidden(entry.Name()) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		if entry.IsDir() {
			dashboard, err := v.dashboardPath(entry.Name())
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, model.TreeNode{
				Name:      entry.Name(),
				Path:      filepath.ToSlash(entry.Name()),
				EntryPath: dashboard,
				IsDir:     true,
				// The project icon is the dashboard page's icon, so it stays in
				// sync between the sidebar and the dashboard landing page.
				Icon: icons[filepath.ToSlash(dashboard)],
			})
			continue
		}
		if !IsMarkdownPath(entry.Name()) {
			continue
		}
		note, err := v.read(entry.Name(), icons)
		if err != nil {
			continue
		}
		nodes = append(nodes, model.TreeNode{
			Name: note.Title,
			Path: note.Path,
			Icon: icons[note.Path],
		})
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].IsDir != nodes[j].IsDir {
			return nodes[i].IsDir
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
	return nodes, nil
}

// Pages returns every note in the vault for search, linking, and favorites.
func (v *Vault) Pages() ([]model.TreeNode, error) {
	files, err := v.MarkdownFiles()
	if err != nil {
		return nil, err
	}
	icons := v.Icons()
	pages := make([]model.TreeNode, 0, len(files))
	for _, path := range files {
		note, err := v.read(path, icons)
		if err != nil {
			continue
		}
		pages = append(pages, model.TreeNode{
			Name: note.Title,
			Path: note.Path,
			Icon: icons[note.Path],
		})
	}
	return pages, nil
}

// EnsureRootDashboards creates dashboard.md in each user-visible root folder.
func (v *Vault) EnsureRootDashboards() error {
	entries, err := os.ReadDir(v.Root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || sidebarHidden(entry.Name()) {
			continue
		}
		if _, err := v.dashboardPath(entry.Name()); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		rel := filepath.ToSlash(filepath.Join(entry.Name(), "dashboard.md"))
		full, err := v.resolve(rel, true)
		if err != nil {
			return err
		}
		content := []byte("# " + entry.Name() + "\n\n")
		if err := createFileExclusive(full, content, 0o644); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
	}
	return nil
}

func (v *Vault) dashboardPath(folder string) (string, error) {
	dir, err := v.resolve(folder, false)
	if err != nil {
		return "", err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 &&
			strings.EqualFold(entry.Name(), "dashboard.md") {
			return filepath.ToSlash(filepath.Join(folder, entry.Name())), nil
		}
	}
	return "", os.ErrNotExist
}

func sidebarHidden(name string) bool {
	return strings.HasPrefix(name, ".") ||
		strings.EqualFold(name, "node_modules") ||
		strings.EqualFold(name, "assets")
}

func IsMarkdownPath(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown" || ext == ".mdx"
}

func (v *Vault) readDir(dir string, depth int, icons map[string]string) ([]model.TreeNode, error) {
	// Always non-nil so it serializes to [] rather than null.
	nodes := []model.TreeNode{}
	if depth > maxTreeDepth {
		return nodes, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if hidden(e.Name()) {
			continue
		}
		full := filepath.Join(dir, e.Name())
		rel, _ := filepath.Rel(v.Root, full)
		rel = filepath.ToSlash(rel)
		// Only recurse into real directories, never into symlinks (loop guard).
		if e.IsDir() && e.Type()&os.ModeSymlink == 0 {
			children, err := v.readDir(full, depth+1, icons)
			if err != nil {
				// Skip unreadable subfolders instead of failing the whole tree.
				continue
			}
			nodes = append(nodes, model.TreeNode{Name: e.Name(), Path: rel, IsDir: true, Children: children})
		} else if !e.IsDir() && IsMarkdownPath(e.Name()) && e.Type()&os.ModeSymlink == 0 {
			nodes = append(nodes, model.TreeNode{
				Name:  strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())),
				Path:  rel,
				IsDir: false,
				Icon:  icons[rel],
			})
		}
	}
	// Folders first, then alphabetical.
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].IsDir != nodes[j].IsDir {
			return nodes[i].IsDir
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
	return nodes, nil
}

// Read loads a note, splitting YAML frontmatter from the body.
func (v *Vault) Read(rel string) (model.Note, error) {
	return v.read(rel, v.Icons())
}

func (v *Vault) read(rel string, icons map[string]string) (model.Note, error) {
	if err := requireUserPath(rel); err != nil {
		return model.Note{}, err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return model.Note{}, err
	}
	full, err := v.resolve(rel, true)
	if err != nil {
		return model.Note{}, err
	}
	if err := recoverBackup(full); err != nil {
		return model.Note{}, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return model.Note{}, err
	}
	if !info.Mode().IsRegular() {
		return model.Note{}, fmt.Errorf("note is not a regular file: %s", rel)
	}
	if info.Size() > maxNoteBytes {
		return model.Note{}, fmt.Errorf("note exceeds the %d MB limit", maxNoteBytes>>20)
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return model.Note{}, err
	}
	fm, _, body := splitFrontmatter(string(raw))
	relSlash := filepath.ToSlash(rel)
	pageID, _ := fm["rockion_id"].(string)
	tag := frontmatterString(fm[templateTagKey])
	if pageID != "" && tag == "" {
		tag = "Other"
	}
	// Created time is taken from the frozen "rockion_created" frontmatter stamp
	// when present; the filesystem birth time is only a fallback because atomic
	// saves (write-temp + rename) reset it to the last save on every edit.
	created := fileCreatedAt(info)
	if c, ok := frontmatterTimeMillis(fm["rockion_created"]); ok {
		created = c
	}
	return model.Note{
		Path:        relSlash,
		Title:       titleFor(rel, fm, body),
		PageID:      pageID,
		Tag:         tag,
		TagColor:    templateTagColor(tag),
		Icon:        icons[relSlash],
		Markdown:    body,
		Frontmatter: fm,
		CreatedAt:   created,
		ModifiedAt:  info.ModTime().UnixMilli(),
		Version:     contentVersion(raw),
	}, nil
}

// frontmatterTimeMillis parses a frontmatter timestamp (YAML may decode it to a
// time.Time, or it may be a string/number) into unix milliseconds.
func frontmatterTimeMillis(v any) (int64, bool) {
	switch t := v.(type) {
	case time.Time:
		return t.UnixMilli(), true
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return 0, false
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
			if tm, err := time.Parse(layout, s); err == nil {
				return tm.UnixMilli(), true
			}
		}
		return 0, false
	case int:
		return int64(t), true
	case int64:
		return t, true
	case float64:
		return int64(t), true
	default:
		return 0, false
	}
}

// Write saves markdown to a note while preserving its existing YAML
// frontmatter. The replacement is atomic so a crash cannot truncate the note.
func (v *Vault) Write(rel, markdown string) error {
	return v.WriteExpected(rel, markdown, "")
}

// WriteExpected writes only if the file still has the content version the
// caller last read. An empty expectedVersion disables the conflict check for
// trusted internal operations.
func (v *Vault) WriteExpected(rel, markdown, expectedVersion string) error {
	if len(markdown) > maxNoteBytes {
		return fmt.Errorf("note exceeds the %d MB limit", maxNoteBytes>>20)
	}
	if err := requireUserPath(rel); err != nil {
		return err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return err
	}
	full, err := v.resolve(rel, true)
	if err != nil {
		return err
	}
	if err := recoverBackup(full); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	header := ""
	if raw, readErr := os.ReadFile(full); readErr == nil {
		if expectedVersion != "" && contentVersion(raw) != expectedVersion {
			return ErrConflict
		}
		_, header, _ = splitFrontmatter(string(raw))
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	} else if expectedVersion != "" {
		return ErrConflict
	}
	content := []byte(header + markdown)
	if len(content) > maxNoteBytes {
		return fmt.Errorf("note and frontmatter exceed the %d MB limit", maxNoteBytes>>20)
	}
	return atomicWriteFileChecked(full, content, 0o644, expectedVersion)
}

// CreateProject creates a root project folder with its dashboard entry page.
func (v *Vault) CreateProject(title string) (note model.Note, err error) {
	title = strings.TrimSpace(title)
	name, err := projectName(title)
	if err != nil {
		return model.Note{}, err
	}
	project, err := v.resolve(name, true)
	if err != nil {
		return model.Note{}, err
	}
	if err := os.Mkdir(project, 0o755); err != nil {
		if errors.Is(err, os.ErrExist) {
			return model.Note{}, fmt.Errorf("project already exists: %s", name)
		}
		return model.Note{}, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(project)
		}
	}()
	rel := filepath.ToSlash(filepath.Join(name, "dashboard.md"))
	full, err := v.resolve(rel, true)
	if err != nil {
		return model.Note{}, err
	}
	if err := createFileExclusive(full, []byte("# "+title+"\n\n"), 0o644); err != nil {
		return model.Note{}, err
	}
	return v.Read(rel)
}

func projectName(title string) (string, error) {
	if strings.TrimSpace(title) == "" {
		return "", errors.New("project name is required")
	}
	if strings.IndexFunc(title, unicode.IsControl) >= 0 {
		return "", errors.New("project name contains control characters")
	}
	name := strings.Trim(sanitize(title), ". ")
	if name == "" || name == "." || name == ".." {
		return "", errors.New("invalid project name")
	}
	if len([]rune(name)) > 120 {
		return "", errors.New("project name is longer than 120 characters")
	}
	if sidebarHidden(name) {
		return "", fmt.Errorf("reserved project name: %s", name)
	}
	device := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	switch device {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return "", fmt.Errorf("reserved project name: %s", name)
	}
	return name, nil
}

// PlanTitleRename computes the vault-relative path a note should have so its
// filename matches title, appending " N" when that name is already taken. It
// returns changed=false (with the original path) when no move is needed — the
// filename already matches, or the title has no usable text.
func (v *Vault) PlanTitleRename(oldRel, title string) (string, bool, error) {
	if err := requireUserPath(oldRel); err != nil {
		return "", false, err
	}
	if strings.EqualFold(filepath.Base(filepath.FromSlash(oldRel)), "dashboard.md") {
		return oldRel, false, nil
	}
	// A blank heading would sanitize to "Untitled"; treat it as "no change" so
	// an empty title doesn't churn files to Untitled.md.
	if strings.TrimSpace(title) == "" {
		return oldRel, false, nil
	}
	base := sanitize(title)
	ext := filepath.Ext(oldRel)
	if ext == "" {
		ext = ".md"
	}
	dir := filepath.ToSlash(filepath.Dir(oldRel))
	if dir == "." {
		dir = ""
	}
	oldSlash := filepath.ToSlash(oldRel)
	oldFull, err := v.resolve(oldRel, false)
	if err != nil {
		return "", false, err
	}
	oldInfo, err := os.Stat(oldFull)
	if err != nil {
		return "", false, err
	}
	makeRel := func(name string) string {
		return filepath.ToSlash(filepath.Join(dir, name+ext))
	}
	candidate := makeRel(base)
	if candidate == oldSlash {
		return oldRel, false, nil
	}
	for i := 2; ; i++ {
		full, err := v.resolve(candidate, true)
		if err != nil {
			return "", false, err
		}
		candidateInfo, statErr := os.Stat(full)
		if os.IsNotExist(statErr) {
			return candidate, true, nil
		} else if statErr != nil {
			return "", false, statErr
		} else if os.SameFile(oldInfo, candidateInfo) {
			return candidate, candidate != oldSlash, nil
		}
		candidate = makeRel(fmt.Sprintf("%s %d", base, i))
		if candidate == oldSlash {
			return oldRel, false, nil
		}
	}
}

// Rename moves a note or folder.
func (v *Vault) Rename(oldRel, newRel string) error {
	if err := requireUserPath(oldRel); err != nil {
		return err
	}
	if err := requireUserPath(newRel); err != nil {
		return err
	}
	from, err := v.resolve(oldRel, false)
	if err != nil {
		return err
	}
	to, err := v.resolve(newRel, true)
	if err != nil {
		return err
	}
	info, err := os.Stat(from)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		if err := requireMarkdownPath(oldRel); err != nil {
			return err
		}
		if err := requireMarkdownPath(newRel); err != nil {
			return err
		}
	}
	toInfo, toErr := os.Lstat(to)
	caseOnlyRename := false
	if toErr == nil {
		caseOnlyRename = os.SameFile(info, toInfo)
		if !caseOnlyRename {
			return fmt.Errorf("destination already exists: %s", newRel)
		}
	} else if !errors.Is(toErr, os.ErrNotExist) {
		return toErr
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	if caseOnlyRename {
		return renameCaseOnly(from, to)
	}
	return os.Rename(from, to)
}

func (v *Vault) IsDir(rel string) (bool, error) {
	if err := requireUserPath(rel); err != nil {
		return false, err
	}
	full, err := v.resolve(rel, false)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}

// Delete removes a note or folder (recursively).
func (v *Vault) Delete(rel string) error {
	if err := requireUserPath(rel); err != nil {
		return err
	}
	full, err := v.resolve(rel, false)
	if err != nil {
		return err
	}
	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		if err := requireMarkdownPath(rel); err != nil {
			return err
		}
		return os.Remove(full)
	}
	if err := ensureNoteOnlyDirectory(full); err != nil {
		return err
	}
	return os.RemoveAll(full)
}

// MarkdownFiles returns all real Markdown files, excluding hidden and generated
// directories. Symlinked files and directories are never followed.
func (v *Vault) MarkdownFiles() ([]string, error) {
	files := []string{}
	err := filepath.WalkDir(v.Root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if path == v.Root {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if hidden(d.Name()) || d.Name() == "assets" {
				return filepath.SkipDir
			}
			return nil
		}
		if !IsMarkdownPath(d.Name()) {
			return nil
		}
		rel, err := filepath.Rel(v.Root, path)
		if err == nil {
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(files)
	return files, err
}

// --- helpers ---

func sanitize(s string) string {
	s = strings.TrimSpace(s)
	repl := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "*", "", "?", "", "\"", "", "<", "", ">", "", "|", "")
	s = repl.Replace(s)
	if s == "" {
		s = "Untitled"
	}
	return s
}

// splitFrontmatter separates a leading YAML block while preserving its exact
// bytes for lossless writes.
func splitFrontmatter(raw string) (map[string]any, string, string) {
	if !strings.HasPrefix(raw, "---\n") && !strings.HasPrefix(raw, "---\r\n") {
		return nil, "", raw
	}
	firstEnd := strings.IndexByte(raw, '\n') + 1
	offset := firstEnd
	for offset <= len(raw) {
		next := strings.IndexByte(raw[offset:], '\n')
		lineEnd := len(raw)
		afterLine := len(raw)
		if next >= 0 {
			lineEnd = offset + next
			afterLine = lineEnd + 1
		}
		line := strings.TrimSuffix(raw[offset:lineEnd], "\r")
		if line == "---" || line == "..." {
			yamlPart := raw[firstEnd:offset]
			fm := map[string]any{}
			if err := yaml.Unmarshal([]byte(yamlPart), &fm); err != nil {
				return nil, "", raw
			}
			return fm, raw[:afterLine], raw[afterLine:]
		}
		if next < 0 {
			break
		}
		offset = afterLine
	}
	return nil, "", raw
}

// titleFor derives a display title: frontmatter title > first H1 > filename.
func titleFor(rel string, fm map[string]any, body string) string {
	if fm != nil {
		if t, ok := fm["title"].(string); ok && t != "" {
			return t
		}
	}
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(line[2:])
		}
	}
	base := filepath.Base(rel)
	return strings.TrimSuffix(base, filepath.Ext(base))
}
