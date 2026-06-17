package search

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"rockion/internal/db"
	"rockion/internal/indexer"
	"rockion/internal/vault"
)

func TestFTSQueryQuotesUserInput(t *testing.T) {
	tests := map[string]string{
		"hello world": `"hello" "world"*`,
		`a"b`:         `"a""b"*`,
		"OR delete":   `"OR" "delete"*`,
		"foo-bar":     `"foo-bar"*`,
	}
	for input, want := range tests {
		if got := ftsQuery(input); got != want {
			t.Fatalf("ftsQuery(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestVaultQueryPrioritizesTitlesAndLimitsContent(t *testing.T) {
	root := t.TempDir()
	v, err := vault.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Project", "Alpha keyword.md"), []byte("# Alpha keyword\n\nno body match\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Project", "Another keyword.md"), []byte("# Another keyword\n\nno body match\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		path := filepath.Join(root, "Project", fmt.Sprintf("Body %d.md", i))
		if err := os.WriteFile(path, []byte(fmt.Sprintf("# Body %d\n\nkeyword appears in content\n", i)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	database, err := db.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := indexer.New(v, database).Rebuild(); err != nil {
		t.Fatal(err)
	}

	results, err := New(database).VaultQuery("keyword", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(results.TitleMatches) != 2 {
		t.Fatalf("title matches = %d, want 2: %+v", len(results.TitleMatches), results.TitleMatches)
	}
	if len(results.ContentMatches) != 5 {
		t.Fatalf("content matches = %d, want 5: %+v", len(results.ContentMatches), results.ContentMatches)
	}
	for _, hit := range results.ContentMatches {
		if hit.Path == "Project/Alpha keyword.md" || hit.Path == "Project/Another keyword.md" {
			t.Fatalf("content results duplicated title match: %+v", hit)
		}
	}
}

func TestVaultQueryFindsBookmarkDescriptions(t *testing.T) {
	root := t.TempDir()
	v, err := vault.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	markdown := `# Research

<figure data-rockion-bookmark data-site="Example">
<a href="https://example.com">Example bookmark</a>
<p>This description contains nebularium and should be indexed.</p>
</figure>
`
	if err := os.WriteFile(filepath.Join(root, "Project", "Research.md"), []byte(markdown), 0o644); err != nil {
		t.Fatal(err)
	}
	database, err := db.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := indexer.New(v, database).Rebuild(); err != nil {
		t.Fatal(err)
	}

	results, err := New(database).VaultQuery("nebularium", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(results.ContentMatches) != 1 {
		t.Fatalf("content matches = %d, want 1: %+v", len(results.ContentMatches), results.ContentMatches)
	}
	if results.ContentMatches[0].Path != "Project/Research.md" {
		t.Fatalf("bookmark description matched wrong page: %+v", results.ContentMatches[0])
	}
}
