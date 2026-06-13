package indexer

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"rockion/internal/db"
	"rockion/internal/vault"
)

func openIndexerTest(t *testing.T) (*vault.Vault, *db.DB, *Indexer) {
	t.Helper()
	dir, err := os.MkdirTemp(".", ".indexer-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	v, err := vault.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	d, err := db.Open(v.Root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return v, d, New(v, d)
}

func TestRebuildIndexesAllSupportedExtensionsAndMetadata(t *testing.T) {
	v, d, ix := openIndexerTest(t)
	files := map[string]string{
		"one.md":         "---\ntags: [alpha, beta]\n---\n# One\n[Two](nested/two.mdx)\n",
		"nested/two.mdx": "# Two\n#body-tag\n[Mail](mailto:test@example.com)\n",
		"three.markdown": "# Three\n",
	}
	for name, content := range files {
		full := filepath.Join(v.Root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := ix.Rebuild(); err != nil {
		t.Fatal(err)
	}
	var notes int
	if err := d.QueryRow(`SELECT count(*) FROM notes`).Scan(&notes); err != nil {
		t.Fatal(err)
	}
	if notes != 3 {
		t.Fatalf("indexed %d notes, want 3", notes)
	}
	var frontmatter string
	if err := d.QueryRow(`SELECT frontmatter FROM notes WHERE path = 'one.md'`).Scan(&frontmatter); err != nil {
		t.Fatal(err)
	}
	if frontmatter == "" || frontmatter == "null" {
		t.Fatalf("frontmatter was not indexed: %q", frontmatter)
	}
	var tags int
	if err := d.QueryRow(`SELECT count(*) FROM tags`).Scan(&tags); err != nil {
		t.Fatal(err)
	}
	if tags != 3 {
		t.Fatalf("indexed %d tags, want 3", tags)
	}
	var links int
	if err := d.QueryRow(`SELECT count(*) FROM links`).Scan(&links); err != nil {
		t.Fatal(err)
	}
	if links != 1 {
		t.Fatalf("indexed %d links, want 1 internal link", links)
	}
}

func TestRemovePathDropsFolderSubtreeAndFTS(t *testing.T) {
	v, d, ix := openIndexerTest(t)
	for _, name := range []string{
		"folder/a.md",
		"folder/nested/b.md",
		"日本語/a.md",
		"日本語/nested/b.md",
		"keep.md",
	} {
		if err := v.Write(name, "# "+name+"\n"); err != nil {
			t.Fatal(err)
		}
	}
	if err := ix.Rebuild(); err != nil {
		t.Fatal(err)
	}
	if err := ix.RemovePath("folder"); err != nil {
		t.Fatal(err)
	}
	if err := ix.RemovePath("日本語"); err != nil {
		t.Fatal(err)
	}
	var notes, fts int
	if err := d.QueryRow(`SELECT count(*) FROM notes`).Scan(&notes); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT count(*) FROM notes_fts`).Scan(&fts); err != nil {
		t.Fatal(err)
	}
	if notes != 1 || fts != 1 {
		t.Fatalf("stale subtree rows remain: notes=%d fts=%d", notes, fts)
	}
}

func TestApplyRenameUpdatesOnlyMovedAndRewrittenNotes(t *testing.T) {
	v, d, ix := openIndexerTest(t)
	if err := v.Write("target.md", "# Target\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("source.md", "[Target](target.md)\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("untouched.md", "# Untouched\n"); err != nil {
		t.Fatal(err)
	}
	if err := ix.Rebuild(); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename("target.md", "renamed.md"); err != nil {
		t.Fatal(err)
	}
	candidates, err := ix.RenameCandidates("target.md", false)
	if err != nil {
		t.Fatal(err)
	}
	wantCandidates := []string{"source.md", "target.md"}
	if !reflect.DeepEqual(candidates, wantCandidates) {
		t.Fatalf("rename candidates = %#v, want %#v", candidates, wantCandidates)
	}
	rewritten, err := v.RewriteLinksAfterRename("target.md", "renamed.md", false, candidates)
	if err != nil {
		t.Fatal(err)
	}
	if err := ix.ApplyRename("target.md", "renamed.md", false, rewritten); err != nil {
		t.Fatal(err)
	}

	var oldCount, newCount, untouchedCount int
	if err := d.QueryRow(`SELECT count(*) FROM notes WHERE path = 'target.md'`).Scan(&oldCount); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT count(*) FROM notes WHERE path = 'renamed.md'`).Scan(&newCount); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT count(*) FROM notes WHERE path = 'untouched.md'`).Scan(&untouchedCount); err != nil {
		t.Fatal(err)
	}
	if oldCount != 0 || newCount != 1 || untouchedCount != 1 {
		t.Fatalf("unexpected index state: old=%d new=%d untouched=%d", oldCount, newCount, untouchedCount)
	}
}
