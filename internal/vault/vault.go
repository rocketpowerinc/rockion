package vault

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"rockion/internal/model"
)

var ErrConflict = errors.New("note changed on disk")

const maxNoteBytes = 32 << 20

// Vault is an opened folder of markdown files.
type Vault struct {
	Root    string
	iconsMu sync.Mutex
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
	return model.Note{
		Path:        relSlash,
		Title:       titleFor(rel, fm, body),
		Icon:        v.Icons()[relSlash],
		Markdown:    body,
		Frontmatter: fm,
		ModifiedAt:  info.ModTime().UnixMilli(),
		Version:     contentVersion(raw),
	}, nil
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

// Create makes a new empty note and returns it.
func (v *Vault) Create(dir, title string) (model.Note, error) {
	name := sanitize(title) + ".md"
	rel := filepath.ToSlash(filepath.Join(dir, name))
	if err := requireUserPath(rel); err != nil {
		return model.Note{}, err
	}
	full, err := v.resolve(rel, true)
	if err != nil {
		return model.Note{}, err
	}
	if _, err := os.Stat(full); err == nil {
		return model.Note{}, fmt.Errorf("note already exists: %s", rel)
	}
	body := "# " + title + "\n\n"
	if err := v.Write(rel, body); err != nil {
		return model.Note{}, err
	}
	return v.Read(rel)
}

// PlanTitleRename computes the vault-relative path a note should have so its
// filename matches title, appending " N" when that name is already taken. It
// returns changed=false (with the original path) when no move is needed — the
// filename already matches, or the title has no usable text.
func (v *Vault) PlanTitleRename(oldRel, title string) (string, bool, error) {
	if err := requireUserPath(oldRel); err != nil {
		return "", false, err
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
		if _, statErr := os.Stat(full); os.IsNotExist(statErr) {
			return candidate, true, nil
		} else if statErr != nil {
			return "", false, statErr
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
	if _, err := os.Lstat(to); err == nil {
		return fmt.Errorf("destination already exists: %s", newRel)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
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

// SaveImage writes image bytes into assets/ and returns the vault-relative path.
func (v *Vault) SaveImage(name string, data []byte) (string, error) {
	const maxImageBytes = 10 << 20
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", errors.New("unsupported or invalid image data")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 12000 || config.Height > 12000 {
		return "", errors.New("image dimensions are invalid or too large")
	}
	extensions := map[string]string{"png": ".png", "jpeg": ".jpg", "gif": ".gif"}
	ext, ok := extensions[format]
	if !ok {
		return "", fmt.Errorf("unsupported image format: %s", format)
	}
	dir, err := v.resolve("assets", true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := sanitize(strings.TrimSuffix(name, filepath.Ext(name)))
	fname := fmt.Sprintf("%s-%d%s", base, time.Now().UnixNano(), ext)
	rel := filepath.ToSlash(filepath.Join("assets", fname))
	full, err := v.resolve(rel, true)
	if err != nil {
		return "", err
	}
	if err := atomicWriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	return rel, nil
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

func atomicWriteFile(path string, data []byte, perm os.FileMode) (err error) {
	return atomicWriteFileChecked(path, data, perm, "")
}

func atomicWriteFileChecked(path string, data []byte, perm os.FileMode, expectedVersion string) (err error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if err = tmp.Chmod(perm); err != nil {
		return err
	}
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if expectedVersion != "" {
		current, readErr := os.ReadFile(path)
		if readErr != nil || contentVersion(current) != expectedVersion {
			return ErrConflict
		}
	}
	if err = replaceFile(tmpName, path); err != nil {
		return err
	}
	return nil
}

func contentVersion(data []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func ensureNoteOnlyDirectory(root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing to delete directory containing a symlink: %s", path)
		}
		if !entry.IsDir() && !IsMarkdownPath(entry.Name()) {
			return fmt.Errorf("refusing to delete directory containing a non-note file: %s", path)
		}
		return nil
	})
}

func recoverBackup(path string) error {
	backup := path + ".rockion-backup"
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	info, err := os.Lstat(backup)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("invalid Rockion recovery backup")
	}
	return os.Rename(backup, path)
}

func replaceFile(tempPath, destination string) error {
	if err := os.Rename(tempPath, destination); err == nil {
		return nil
	}
	// Windows does not replace an existing destination with os.Rename.
	backup := destination + ".rockion-backup"
	_ = os.Remove(backup)
	if err := os.Rename(destination, backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tempPath, destination); err != nil {
		_ = os.Rename(backup, destination)
		return err
	}
	_ = os.Remove(backup)
	return nil
}
