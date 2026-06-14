package vault

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"rockion/internal/model"
)

func TestDashboardCardsFollowManagedLinkOrderAndReorderSafely(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	first, err := v.CreateManagedPage("Project/dashboard.md", "First")
	if err != nil {
		t.Fatal(err)
	}
	second, err := v.CreateManagedPage("Project/dashboard.md", "Second")
	if err != nil {
		t.Fatal(err)
	}
	markdown := "# Project\n\nIntro stays here.\n\n- " +
		managedLink("Project/dashboard.md", second, "Second") + "\n- " +
		managedLink("Project/dashboard.md", first, "First") + "\n"
	if err := v.Write("Project/dashboard.md", markdown); err != nil {
		t.Fatal(err)
	}

	cards, err := v.DashboardCards("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{cards[0].PageID, cards[1].PageID}; !reflect.DeepEqual(
		got, []string{second.PageID, first.PageID},
	) {
		t.Fatalf("card order = %v", got)
	}
	for _, card := range cards {
		if card.Tag != "Other" || card.TagColor != "gray" {
			t.Fatalf("blank card tag = %q/%q", card.Tag, card.TagColor)
		}
	}
	if err := v.ReorderManagedPages(
		"Project/dashboard.md",
		[]string{first.PageID, second.PageID},
	); err != nil {
		t.Fatal(err)
	}
	updated, err := v.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(updated.Markdown, "Intro stays here.") {
		t.Fatal("reorder removed non-managed dashboard content")
	}
	if strings.Index(updated.Markdown, first.PageID) > strings.Index(updated.Markdown, second.PageID) {
		t.Fatal("managed links were not reordered")
	}
}

func TestDashboardCardsExposeTemplateTags(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsurePageTemplates(); err != nil {
		t.Fatal(err)
	}
	page, err := v.CreateManagedPageFromTemplate(
		"Project/dashboard.md",
		"Bootstrap Page",
		"Bootstrap.md",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := v.Write(
		"Project/dashboard.md",
		"# Project\n\n- "+managedLink("Project/dashboard.md", page, page.Title)+"\n",
	); err != nil {
		t.Fatal(err)
	}
	cards, err := v.DashboardCards("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 1 || cards[0].Tag != "Bootstrap" || cards[0].TagColor != "green" {
		t.Fatalf("template card = %#v", cards)
	}
	if cards[0].Path != "Project/Bootstraps/Bootstrap Page.md" {
		t.Fatalf("template card path = %q", cards[0].Path)
	}
}

func TestDashboardViewSidecarPreservesFrontmatterBytes(t *testing.T) {
	v := openTestVault(t)
	if err := os.Mkdir(filepath.Join(v.Root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	const original = "---\n# keep this comment\ntitle: \"Project\"\ntags: [one, two]\n---\n# Project\n\n"
	if err := os.WriteFile(
		filepath.Join(v.Root, "Project", "dashboard.md"),
		[]byte(original),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	view := model.DashboardView{View: "list", SortBy: "modified", SortDir: "desc"}
	if err := v.SetDashboardView("Project/dashboard.md", view); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(v.Root, "Project", "dashboard.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != original {
		t.Fatalf("dashboard Markdown changed:\n%s", raw)
	}
	got, err := v.DashboardView("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, view) {
		t.Fatalf("dashboard view = %#v, want %#v", got, view)
	}
	if _, err := os.Stat(v.dashboardViewsPath()); err != nil {
		t.Fatal("dashboard view sidecar was not created:", err)
	}
}

func TestDashboardViewAllowsTagSorting(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	view := model.DashboardView{View: "list", SortBy: "tag", SortDir: "asc"}
	if err := v.SetDashboardView("Project/dashboard.md", view); err != nil {
		t.Fatal(err)
	}
	got, err := v.DashboardView("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, view) {
		t.Fatalf("tag-sorted dashboard view = %#v, want %#v", got, view)
	}
}

func TestDashboardViewMetadataFollowsProjectRenameAndDelete(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	view := model.DashboardView{View: "list", SortBy: "title", SortDir: "asc"}
	if err := v.SetDashboardView("Project/dashboard.md", view); err != nil {
		t.Fatal(err)
	}
	if err := v.Rename("Project", "Renamed"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenameDashboardViewPath("Project", "Renamed", true); err != nil {
		t.Fatal(err)
	}
	got, err := v.DashboardView("Renamed/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, view) {
		t.Fatalf("renamed dashboard view = %#v", got)
	}
	if err := v.RemoveDashboardViewPath("Renamed", true); err != nil {
		t.Fatal(err)
	}
	got, err = v.DashboardView("Renamed/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if got.View != "gallery" || got.SortBy != "" || got.SortDir != "" {
		t.Fatalf("removed dashboard view = %#v", got)
	}
}

func TestDashboardViewReadsLegacyFrontmatterWithoutRewritingIt(t *testing.T) {
	v := openTestVault(t)
	if err := os.Mkdir(filepath.Join(v.Root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	const original = "---\nrockion_view: list\nrockion_sort: created\nrockion_sort_dir: desc\n---\n# Project\n"
	if err := os.WriteFile(
		filepath.Join(v.Root, "Project", "dashboard.md"),
		[]byte(original),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	view, err := v.DashboardView("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if view.View != "list" || view.SortBy != "created" || view.SortDir != "desc" {
		t.Fatalf("legacy dashboard view = %#v", view)
	}
	raw, err := os.ReadFile(filepath.Join(v.Root, "Project", "dashboard.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != original {
		t.Fatal("reading legacy view rewrote the dashboard")
	}

	if err := v.SetDashboardView("Project/dashboard.md", model.DashboardView{
		View: "gallery",
	}); err != nil {
		t.Fatal(err)
	}
	view, err = v.DashboardView("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if view.View != "gallery" || view.SortBy != "" || view.SortDir != "" {
		t.Fatalf("default sidecar view did not override legacy frontmatter: %#v", view)
	}
	raw, err = os.ReadFile(filepath.Join(v.Root, "Project", "dashboard.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != original {
		t.Fatal("setting a sidecar view rewrote legacy frontmatter")
	}
}
