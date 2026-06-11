package vault

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"rockion/internal/model"
)

// Vault is an opened folder of markdown files.
type Vault struct {
	Root string
}

// Open returns a Vault rooted at an existing directory.
func Open(root string) (*Vault, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	return &Vault{Root: filepath.Clean(root)}, nil
}

func (v *Vault) Info() model.VaultInfo {
	return model.VaultInfo{Path: v.Root, Name: filepath.Base(v.Root)}
}

// abs resolves a vault-relative path and guards against escaping the root.
func (v *Vault) abs(rel string) (string, error) {
	clean := filepath.Clean("/" + rel) // force-rooted, strips ../
	full := filepath.Join(v.Root, clean)
	if !strings.HasPrefix(full, v.Root) {
		return "", errors.New("path escapes vault")
	}
	return full, nil
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
	return v.readDir(v.Root, 0)
}

func isMarkdown(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown" || ext == ".mdx"
}

func (v *Vault) readDir(dir string, depth int) ([]model.TreeNode, error) {
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
			children, err := v.readDir(full, depth+1)
			if err != nil {
				// Skip unreadable subfolders instead of failing the whole tree.
				continue
			}
			nodes = append(nodes, model.TreeNode{Name: e.Name(), Path: rel, IsDir: true, Children: children})
		} else if !e.IsDir() && isMarkdown(e.Name()) {
			nodes = append(nodes, model.TreeNode{Name: strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())), Path: rel, IsDir: false})
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
	full, err := v.abs(rel)
	if err != nil {
		return model.Note{}, err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return model.Note{}, err
	}
	info, _ := os.Stat(full)
	fm, body := splitFrontmatter(string(raw))
	return model.Note{
		Path:        filepath.ToSlash(rel),
		Title:       titleFor(rel, fm, body),
		Markdown:    body,
		Frontmatter: fm,
		ModifiedAt:  info.ModTime().Unix(),
	}, nil
}

// Write saves markdown to a note, creating parent dirs as needed.
func (v *Vault) Write(rel, markdown string) error {
	full, err := v.abs(rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(markdown), 0o644)
}

// Create makes a new empty note and returns it.
func (v *Vault) Create(dir, title string) (model.Note, error) {
	name := sanitize(title) + ".md"
	rel := filepath.ToSlash(filepath.Join(dir, name))
	full, err := v.abs(rel)
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

// Rename moves a note or folder.
func (v *Vault) Rename(oldRel, newRel string) error {
	from, err := v.abs(oldRel)
	if err != nil {
		return err
	}
	to, err := v.abs(newRel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	return os.Rename(from, to)
}

// Delete removes a note or folder (recursively).
func (v *Vault) Delete(rel string) error {
	full, err := v.abs(rel)
	if err != nil {
		return err
	}
	return os.RemoveAll(full)
}

// SaveImage writes image bytes into assets/ and returns the vault-relative path.
func (v *Vault) SaveImage(name string, data []byte) (string, error) {
	dir := filepath.Join(v.Root, "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := sanitize(strings.TrimSuffix(name, filepath.Ext(name)))
	ext := filepath.Ext(name)
	if ext == "" {
		ext = ".png"
	}
	fname := fmt.Sprintf("%s-%d%s", base, time.Now().UnixNano(), ext)
	rel := filepath.ToSlash(filepath.Join("assets", fname))
	if err := os.WriteFile(filepath.Join(v.Root, "assets", fname), data, 0o644); err != nil {
		return "", err
	}
	return rel, nil
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

// splitFrontmatter separates a leading `---` YAML block from the body.
func splitFrontmatter(raw string) (map[string]any, string) {
	if !strings.HasPrefix(raw, "---\n") && !strings.HasPrefix(raw, "---\r\n") {
		return nil, raw
	}
	rest := raw[strings.IndexByte(raw, '\n')+1:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, raw
	}
	yamlPart := rest[:end]
	body := rest[end+4:] // skip "\n---"
	body = strings.TrimPrefix(body, "\n")
	body = strings.TrimPrefix(body, "\r\n")

	fm := map[string]any{}
	if err := yaml.Unmarshal([]byte(yamlPart), &fm); err != nil {
		return nil, raw
	}
	return fm, body
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
