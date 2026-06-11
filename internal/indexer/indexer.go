package indexer

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

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
}

func New(v *vault.Vault, d *db.DB) *Indexer {
	return &Indexer{v: v, db: d}
}

// Rebuild does a full walk + reindex. Cheap enough for thousands of files;
// for incremental updates use IndexFile on change events.
func (ix *Indexer) Rebuild() error {
	if err := ix.db.Reset(); err != nil {
		return err
	}
	return filepath.WalkDir(ix.v.Root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries
		}
		name := d.Name()
		if d.IsDir() {
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "assets" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(name), ".md") {
			return nil
		}
		rel, _ := filepath.Rel(ix.v.Root, path)
		return ix.IndexFile(filepath.ToSlash(rel))
	})
}

// IndexFile (re)indexes a single note by vault-relative path.
func (ix *Indexer) IndexFile(rel string) error {
	note, err := ix.v.Read(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(filepath.Join(ix.v.Root, filepath.FromSlash(rel)))
	if err != nil {
		return err
	}

	tx, err := ix.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Remove any prior rows for this path.
	tx.Exec(`DELETE FROM links WHERE source_id IN (SELECT id FROM notes WHERE path = ?)`, rel)
	tx.Exec(`DELETE FROM tags  WHERE note_id  IN (SELECT id FROM notes WHERE path = ?)`, rel)
	tx.Exec(`DELETE FROM notes_fts WHERE path = ?`, rel)
	tx.Exec(`DELETE FROM notes WHERE path = ?`, rel)

	res, err := tx.Exec(
		`INSERT INTO notes(path, title, modified_at, size, frontmatter) VALUES(?,?,?,?,?)`,
		rel, note.Title, info.ModTime().Unix(), info.Size(), "",
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
		tx.Exec(`INSERT INTO links(source_id, target_path, kind) VALUES(?,?,'wikilink')`, id, target)
	}
	for _, m := range mdlinkRe.FindAllStringSubmatch(note.Markdown, -1) {
		target := strings.TrimSpace(m[1])
		if !strings.HasPrefix(target, "http") {
			tx.Exec(`INSERT INTO links(source_id, target_path, kind) VALUES(?,?,'markdown')`, id, target)
		}
	}
	seen := map[string]bool{}
	for _, m := range hashtagRe.FindAllStringSubmatch(note.Markdown, -1) {
		tag := m[1]
		if !seen[tag] {
			seen[tag] = true
			tx.Exec(`INSERT INTO tags(note_id, tag) VALUES(?,?)`, id, tag)
		}
	}

	return tx.Commit()
}

// RemoveFile drops a note from the index (after deletion on disk).
func (ix *Indexer) RemoveFile(rel string) error {
	_, err := ix.db.Exec(`DELETE FROM notes WHERE path = ?`, rel)
	ix.db.Exec(`DELETE FROM notes_fts WHERE path = ?`, rel)
	return err
}

// firstHeading is a small helper kept for callers that only have a body.
func firstHeading(body string) string {
	if m := h1Re.FindStringSubmatch(body); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

var _ = firstHeading
