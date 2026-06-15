package vault

import (
	"os"
	"path/filepath"
	"testing"

	"rockion/internal/model"
)

func TestPageSettingsPersistAndFollowLifecycle(t *testing.T) {
	v, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Project/Page.md", "# Page\n"); err != nil {
		t.Fatal(err)
	}
	want := model.PageSettings{Locked: true, FullWidth: true}
	if err := v.SetPageSettings("Project/Page.md", want); err != nil {
		t.Fatal(err)
	}
	got, err := v.PageSettings("Project/Page.md")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("page settings = %#v, want %#v", got, want)
	}

	if err := v.Rename("Project", "Renamed"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenamePageSettingsPath("Project", "Renamed", true); err != nil {
		t.Fatal(err)
	}
	got, err = v.PageSettings("Renamed/Page.md")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("renamed page settings = %#v, want %#v", got, want)
	}

	if err := v.RemovePageSettingsPath("Renamed/Page.md", false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(v.Root, ".rockion", "page-settings.json")); !os.IsNotExist(err) {
		t.Fatalf("empty page settings sidecar remains: %v", err)
	}
}

func TestPageSettingsDoNotRewriteMarkdown(t *testing.T) {
	v, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const markdown = "---\ncustom: keep\n---\n# Page\n\nBody\n"
	if err := v.Write("Page.md", markdown); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(v.Root, "Page.md"))
	if err != nil {
		t.Fatal(err)
	}
	if err := v.SetPageSettings("Page.md", model.PageSettings{Locked: true}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(v.Root, "Page.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("setting page options rewrote Markdown")
	}
}
