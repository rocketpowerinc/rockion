package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"rockion/internal/db"
	"rockion/internal/vault"
)

var (
	wikilinkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	mdlinkRe   = regexp.MustCompile(`\[[^\]]*\]\(([^)]+)\)`)
	hashtagRe  = regexp.MustCompile(`(?:^|\s)#([A-Za-z0-9_\-/]+)`)
	h1Re       = regexp.MustCompile(`(?m)^#\s+(.+)$`)
)

// Indexer keeps the SQLite index in sync with the vault.
type Indexer struct {
	v  *vault.Vault
	db *db.DB
	mu sync.Mutex
}

func New(v *vault.Vault, d *db.DB) *Indexer {
	return &Indexer{v: v, db: d}
}

// Rebuild does a full walk + reindex. Cheap enough for thousands of files;
// for incremental updates use IndexFile on change events.
func (ix *Indexer) Rebuild() error {
	return ix.RebuildContext(context.Background())
}

func (ix *Indexer) RebuildContext(ctx context.Context) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if err := ix.db.Reset(); err != nil {
		return err
	}
	files, err := ix.v.MarkdownFiles()
	if err != nil {
		return err
	}
	for _, rel := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := ix.indexFile(rel); err != nil {
			return err
		}
	}
	return nil
}

// IndexFile (re)indexes a single note by vault-relative path.
func (ix *Indexer) IndexFile(rel string) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	return ix.indexFile(rel)
}

func (ix *Indexer) indexFile(rel string) error {
	rel = filepath.ToSlash(filepath.Clean(rel))
	if !vault.IsMarkdownPath(rel) {
		return nil
	}
	note, err := ix.v.Read(rel)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ix.removePath(rel)
		}
		return err
	}
	info, err := os.Stat(filepath.Join(ix.v.Root, filepath.FromSlash(note.Path)))
	if err != nil {
		return err
	}

	tx, err := ix.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Remove any prior rows for this path.
	for _, query := range []string{
		`DELETE FROM links WHERE source_id IN (SELECT id FROM notes WHERE path = ?)`,
		`DELETE FROM tags WHERE note_id IN (SELECT id FROM notes WHERE path = ?)`,
		`DELETE FROM notes_fts WHERE path = ?`,
		`DELETE FROM notes WHERE path = ?`,
	} {
		if _, err := tx.Exec(query, rel); err != nil {
			return err
		}
	}

	frontmatter, err := json.Marshal(note.Frontmatter)
	if err != nil {
		return err
	}
	res, err := tx.Exec(
		`INSERT INTO notes(path, title, modified_at, size, frontmatter) VALUES(?,?,?,?,?)`,
		rel, note.Title, info.ModTime().UnixMilli(), info.Size(), string(frontmatter),
	)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()

	if _, err := tx.Exec(
		`INSERT INTO notes_fts(rowid, title, body, path) VALUES(?,?,?,?)`,
		id, note.Title, note.Markdown, rel,
	); err != nil {
		return err
	}

	for _, m := range wikilinkRe.FindAllStringSubmatch(note.Markdown, -1) {
		target := strings.TrimSpace(strings.SplitN(m[1], "|", 2)[0])
		if target == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO links(source_id, target_path, kind) VALUES(?,?,'wikilink')`, id, target); err != nil {
			return err
		}
	}
	for _, m := range mdlinkRe.FindAllStringSubmatch(note.Markdown, -1) {
		target, ok := normalizeMarkdownTarget(rel, m[1])
		if ok {
			if _, err := tx.Exec(`INSERT INTO links(source_id, target_path, kind) VALUES(?,?,'markdown')`, id, target); err != nil {
				return err
			}
		}
	}
	seen := map[string]bool{}
	for _, m := range hashtagRe.FindAllStringSubmatch(note.Markdown, -1) {
		tag := m[1]
		if !seen[tag] {
			seen[tag] = true
			if _, err := tx.Exec(`INSERT INTO tags(note_id, tag) VALUES(?,?)`, id, tag); err != nil {
				return err
			}
		}
	}
	for _, tag := range frontmatterTags(note.Frontmatter) {
		if !seen[tag] {
			seen[tag] = true
			if _, err := tx.Exec(`INSERT INTO tags(note_id, tag) VALUES(?,?)`, id, tag); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// RemoveFile drops a note from the index (after deletion on disk).
func (ix *Indexer) RemoveFile(rel string) error {
	return ix.RemovePath(rel)
}

// RemovePath drops one note or every indexed note under a deleted folder.
func (ix *Indexer) RemovePath(rel string) error {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	return ix.removePath(rel)
}

func (ix *Indexer) removePath(rel string) error {
	rel = filepath.ToSlash(filepath.Clean(rel))
	tx, err := ix.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, query := range []string{
		`DELETE FROM notes_fts WHERE path = ? OR substr(path, 1, ?) = ?`,
		`DELETE FROM notes WHERE path = ? OR substr(path, 1, ?) = ?`,
	} {
		prefix := rel + "/"
		if _, err := tx.Exec(query, rel, len(prefix), prefix); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// firstHeading is a small helper kept for callers that only have a body.
func firstHeading(body string) string {
	if m := h1Re.FindStringSubmatch(body); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

var _ = firstHeading

func normalizeMarkdownTarget(sourceRel, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "<") {
		if end := strings.Index(raw, ">"); end >= 0 {
			raw = raw[1:end]
		}
	} else if i := strings.IndexAny(raw, " \t"); i >= 0 {
		raw = raw[:i]
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" ||
		strings.HasPrefix(raw, "#") || strings.HasPrefix(parsed.Path, "/") {
		return "", false
	}
	decoded, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", false
	}
	target := filepath.Join(filepath.Dir(filepath.FromSlash(sourceRel)), filepath.FromSlash(decoded))
	target = filepath.ToSlash(filepath.Clean(target))
	if !vault.IsMarkdownPath(target) {
		return "", false
	}
	return target, true
}

func frontmatterTags(frontmatter map[string]any) []string {
	if frontmatter == nil {
		return nil
	}
	raw, ok := frontmatter["tags"]
	if !ok {
		return nil
	}
	tags := []string{}
	appendTag := func(value string) {
		for _, tag := range strings.FieldsFunc(value, func(r rune) bool {
			return r == ',' || r == ' ' || r == '#'
		}) {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}
	switch value := raw.(type) {
	case string:
		appendTag(value)
	case []any:
		for _, item := range value {
			if text, ok := item.(string); ok {
				appendTag(text)
			}
		}
	case []string:
		for _, item := range value {
			appendTag(item)
		}
	}
	return tags
}
