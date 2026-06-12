package vault

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func openTestVault(t *testing.T) *Vault {
	t.Helper()
	dir, err := os.MkdirTemp(".", ".vault-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	v, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestWritePreservesFrontmatter(t *testing.T) {
	v := openTestVault(t)
	path := filepath.Join(v.Root, "note.md")
	original := "---\r\ntitle: Preserved\r\ntags:\r\n  - secure\r\n---\r\nOld body\r\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := v.Write("note.md", "# New body\n"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := "---\r\ntitle: Preserved\r\ntags:\r\n  - secure\r\n---\r\n# New body\n"
	if string(got) != want {
		t.Fatalf("frontmatter changed\nwant: %q\n got: %q", want, string(got))
	}
}

func TestWriteExpectedDetectsExternalChange(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("note.md", "first"); err != nil {
		t.Fatal(err)
	}
	note, err := v.Read("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "note.md"), []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := v.WriteExpected("note.md", "local", note.Version); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	got, err := os.ReadFile(filepath.Join(v.Root, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "external" {
		t.Fatalf("external edit was overwritten: %q", got)
	}
}

func TestReadReportsMillisecondsAndBodyOnly(t *testing.T) {
	v := openTestVault(t)
	if err := os.WriteFile(
		filepath.Join(v.Root, "note.md"),
		[]byte("---\ntitle: Frontmatter title\n---\nBody\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	note, err := v.Read("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if note.Title != "Frontmatter title" || note.Markdown != "Body\n" {
		t.Fatalf("unexpected note: %#v", note)
	}
	if note.ModifiedAt < 1_000_000_000_000 {
		t.Fatalf("modifiedAt is not Unix milliseconds: %d", note.ModifiedAt)
	}
}

func TestDestructiveAndTraversalPathsAreRejected(t *testing.T) {
	v := openTestVault(t)
	if err := os.WriteFile(filepath.Join(v.Root, "note.md"), []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"", ".", "..", "../outside.md", filepath.Join(v.Root, "note.md")} {
		if err := v.Delete(path); err == nil {
			t.Fatalf("Delete(%q) unexpectedly succeeded", path)
		}
	}
	if _, err := os.Stat(filepath.Join(v.Root, "note.md")); err != nil {
		t.Fatalf("valid vault content was removed: %v", err)
	}
}

func TestDeleteRefusesProtectedAndMixedContentDirectories(t *testing.T) {
	v := openTestVault(t)
	if err := os.MkdirAll(filepath.Join(v.Root, "mixed"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "mixed", "note.md"), []byte("note"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "mixed", "data.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := v.Delete("mixed"); err == nil {
		t.Fatal("mixed-content directory was deleted")
	}
	if err := v.Delete(".rockion"); err == nil {
		t.Fatal("protected metadata directory was deletable")
	}
	if _, err := v.Create(".rockion", "hidden"); err == nil {
		t.Fatal("note creation in protected metadata succeeded")
	}
	if _, err := v.Create("NODE_MODULES", "hidden"); err == nil {
		t.Fatal("case-insensitive node_modules protection failed")
	}
	if _, err := os.Stat(filepath.Join(v.Root, "mixed", "data.txt")); err != nil {
		t.Fatalf("non-note content was removed: %v", err)
	}
}

func TestSymlinkNoteIsRejected(t *testing.T) {
	v := openTestVault(t)
	outsideDir, err := os.MkdirTemp(".", ".outside-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(outsideDir) })
	outside := filepath.Join(outsideDir, "outside.md")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(v.Root, "linked.md")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if _, err := v.Read("linked.md"); err == nil {
		t.Fatal("symlink note was readable")
	}
	if err := v.Write("linked.md", "overwrite"); err == nil {
		t.Fatal("symlink note was writable")
	}
}

func TestRenameDoesNotOverwrite(t *testing.T) {
	v := openTestVault(t)
	if err := os.WriteFile(filepath.Join(v.Root, "a.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "b.md"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename("a.md", "b.md"); err == nil {
		t.Fatal("rename unexpectedly overwrote destination")
	}
}

func TestSaveImageValidatesAndNormalizesFormat(t *testing.T) {
	v := openTestVault(t)
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	rel, err := v.SaveImage("unsafe.exe", encoded.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(rel, ".png") {
		t.Fatalf("image format was not normalized: %s", rel)
	}
	if _, err := v.SaveImage("bad.png", []byte("not an image")); err == nil {
		t.Fatal("invalid image was accepted")
	}
}

func TestSetIconRequiresNoteAndRejectsInvalidDataURL(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("note.md", "# Note\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.SetIcon("note.md", "data:text/html;base64,SGk="); err == nil {
		t.Fatal("unsafe icon data URL was accepted")
	}
	if err := v.SetIcon("missing.md", "x"); err == nil {
		t.Fatal("icon was stored for a missing note")
	}
	if err := v.SetIcon("note.md", "📝"); err != nil {
		t.Fatal(err)
	}
	if got := v.Icons()["note.md"]; got != "📝" {
		t.Fatalf("icon was not saved: %q", got)
	}
}

func TestRenameMigratesLinksAndIcons(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("target.md", "# Target\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("source.md", "[Target](target.md)\n\n[[target|Alias]]\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.SetIcon("target.md", "🎯"); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename("target.md", "renamed.md"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenameIconPath("target.md", "renamed.md", false); err != nil {
		t.Fatal(err)
	}
	if err := v.RewriteLinksAfterRename("target.md", "renamed.md", false); err != nil {
		t.Fatal(err)
	}
	source, err := v.Read("source.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(source.Markdown, "[Target](renamed.md)") ||
		!strings.Contains(source.Markdown, "[[renamed|Alias]]") {
		t.Fatalf("links were not migrated: %q", source.Markdown)
	}
	if got := v.Icons()["renamed.md"]; got != "🎯" {
		t.Fatalf("icon was not migrated: %q", got)
	}
	if _, exists := v.Icons()["target.md"]; exists {
		t.Fatal("old icon key remains")
	}
}

func TestReadRecoversInterruptedAtomicReplacement(t *testing.T) {
	v := openTestVault(t)
	path := filepath.Join(v.Root, "note.md")
	if err := os.WriteFile(path+".rockion-backup", []byte("# Recovered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	note, err := v.Read("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if note.Markdown != "# Recovered\n" {
		t.Fatalf("backup was not recovered: %q", note.Markdown)
	}
}

func TestFolderMoveRecalculatesRelativeLinks(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("target.md", "# Target\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("old/source.md", "[Target](../target.md)\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename("old", "archive/deep"); err != nil {
		t.Fatal(err)
	}
	if err := v.RewriteLinksAfterRename("old", "archive/deep", true); err != nil {
		t.Fatal(err)
	}
	source, err := v.Read("archive/deep/source.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(source.Markdown, "[Target](../../target.md)") {
		t.Fatalf("relative link was not recalculated: %q", source.Markdown)
	}
}
