package vault

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rockion/internal/model"
)

func TestManagedDashboardMigrationAddsStableIDs(t *testing.T) {
	v := openTestVault(t)
	if err := os.Mkdir(filepath.Join(v.Root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Project/dashboard.md", "# Project\n\n[Old label](Page.md)\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Project/Page.md", "# Page\n\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsureManagedDashboards(); err != nil {
		t.Fatal(err)
	}
	page, err := v.Read("Project/Page.md")
	if err != nil {
		t.Fatal(err)
	}
	if page.PageID == "" {
		t.Fatal("migrated page did not receive a stable ID")
	}
	raw, err := os.ReadFile(filepath.Join(v.Root, "Project", "Page.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "rockion_id: "+page.PageID) {
		t.Fatalf("stable ID missing from frontmatter: %q", raw)
	}
	dashboard, err := v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dashboard.Markdown, "rockion-page="+page.PageID) ||
		!strings.Contains(dashboard.Markdown, "[Old label]") {
		t.Fatalf("dashboard link was not migrated with alias preserved: %q", dashboard.Markdown)
	}
}

func TestManagedDashboardRepairsDuplicatePageIDs(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	original, err := v.CreateManagedPage("Project/dashboard.md", "Original")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(v.Root, filepath.FromSlash(original.Path)))
	if err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(v.Root, "Project", "Copy.md")
	if err := os.WriteFile(copyPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := v.EnsureManagedDashboards(); err != nil {
		t.Fatal(err)
	}
	original, err = v.Read(original.Path)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := v.Read("Project/Copy.md")
	if err != nil {
		t.Fatal(err)
	}
	if original.PageID == copied.PageID {
		t.Fatalf("copied pages retained duplicate ID %q", original.PageID)
	}
	dashboard, err := v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range []model.Note{original, copied} {
		if !strings.Contains(dashboard.Markdown, "rockion-page="+page.PageID) {
			t.Fatalf("dashboard is missing page %q: %q", page.Path, dashboard.Markdown)
		}
	}
}

func TestManagedDashboardLinkTracksTitleAndPreservesAliases(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	page, err := v.CreateManagedPage("Project/dashboard.md", "First")
	if err != nil {
		t.Fatal(err)
	}
	link := managedLink("Project/dashboard.md", page, "First")
	if err := v.Write("Project/dashboard.md", "# Project\n\n- "+link+"\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write(page.Path, "# Second\n\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename(page.Path, "Project/Other/Second.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.RewriteLinksAfterRename(
		page.Path,
		"Project/Other/Second.md",
		false,
		[]string{"Project/dashboard.md"},
	); err != nil {
		t.Fatal(err)
	}
	if _, _, err := v.NormalizeDashboardForPage("Project/Other/Second.md"); err != nil {
		t.Fatal(err)
	}
	dashboard, err := v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dashboard.Markdown, "[Second](Other/Second.md?") {
		t.Fatalf("managed label did not follow title: %q", dashboard.Markdown)
	}

	aliased := strings.Replace(dashboard.Markdown, "[Second]", "[Pinned name]", 1)
	if err := v.Write("Project/dashboard.md", aliased); err != nil {
		t.Fatal(err)
	}
	if _, err := v.NormalizeManagedDashboard("Project/dashboard.md"); err != nil {
		t.Fatal(err)
	}
	dashboard, err = v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dashboard.Markdown, "[Pinned name]") {
		t.Fatalf("custom alias was overwritten: %q", dashboard.Markdown)
	}
}

func TestManagedDashboardRestoresRemovedLinksAndDeletesThroughLink(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	page, err := v.CreateManagedPage("Project/dashboard.md", "Page")
	if err != nil {
		t.Fatal(err)
	}
	link := managedLink("Project/dashboard.md", page, "Page")
	if err := v.Write("Project/dashboard.md", "# Project\n\n- "+link+"\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Project/dashboard.md", "# Project\n\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.NormalizeManagedDashboard("Project/dashboard.md"); err != nil {
		t.Fatal(err)
	}
	dashboard, err := v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dashboard.Markdown, "rockion-page="+page.PageID) {
		t.Fatalf("removed managed link was not restored: %q", dashboard.Markdown)
	}
	result, err := v.DeleteManagedPage(
		"Project/dashboard.md",
		"Page.md?rockion-page="+page.PageID,
		dashboard.Version,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Dashboard.Markdown, page.PageID) {
		t.Fatal("managed link remains after deletion")
	}
	if _, err := os.Stat(filepath.Join(v.Root, filepath.FromSlash(page.Path))); !os.IsNotExist(err) {
		t.Fatal("managed page file remains after deletion")
	}
}
