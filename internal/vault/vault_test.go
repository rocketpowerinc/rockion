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
	"sync"
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

func TestCreateVaultCreatesSafeNamedDirectory(t *testing.T) {
	parent, err := os.MkdirTemp(".", ".vault-parent-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(parent) })

	created, err := Create(parent, "My Vault")
	if err != nil {
		t.Fatal(err)
	}
	if created.Info().Name != "My Vault" {
		t.Fatalf("unexpected vault name: %q", created.Info().Name)
	}
	info, err := os.Stat(created.Root)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatalf("created vault is not a directory: %s", created.Root)
	}
	if _, err := Create(parent, "My Vault"); err == nil {
		t.Fatal("duplicate vault creation unexpectedly succeeded")
	}
}

func TestCreateVaultRejectsUnsafeNames(t *testing.T) {
	parent, err := os.MkdirTemp(".", ".vault-parent-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(parent) })

	for _, name := range []string{"", ".", "..", "CON"} {
		if _, err := Create(parent, name); err == nil {
			t.Fatalf("Create(%q) unexpectedly succeeded", name)
		}
	}
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
	if _, err := v.RewriteLinksAfterRename(
		"target.md",
		"renamed.md",
		false,
		[]string{"source.md"},
	); err != nil {
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
	if _, err := v.RewriteLinksAfterRename(
		"old",
		"archive/deep",
		true,
		[]string{"old/source.md"},
	); err != nil {
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

func TestCreateIsExclusive(t *testing.T) {
	v := openTestVault(t)
	if err := os.Mkdir(filepath.Join(v.Root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Project/dashboard.md", "# Project\n\n"); err != nil {
		t.Fatal(err)
	}
	const attempts = 8
	var wg sync.WaitGroup
	results := make(chan error, attempts)
	for range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := v.CreateManagedPage("Project/dashboard.md", "Only Once")
			results <- err
		}()
	}
	wg.Wait()
	close(results)

	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("exclusive create succeeded %d times, want 1", successes)
	}
	note, err := v.Read("Project/Other/Only Once.md")
	if err != nil {
		t.Fatal(err)
	}
	if note.Markdown != "# Only Once\n\n" {
		t.Fatalf("created note was corrupted: %q", note.Markdown)
	}
}

func TestCreateProjectCreatesDashboardAndRejectsCollisions(t *testing.T) {
	v := openTestVault(t)
	dashboard, err := v.CreateProject("Client Work")
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.Path != "Client Work/dashboard.md" ||
		dashboard.Markdown != "# Client Work\n\n" {
		t.Fatalf("created project dashboard = %#v", dashboard)
	}
	if _, err := v.CreateProject("Client Work"); err == nil {
		t.Fatal("duplicate project was created")
	}
	if _, err := v.CreateProject("assets"); err == nil {
		t.Fatal("reserved project was created")
	}
	if _, err := v.CreateProject("CON.txt"); err == nil {
		t.Fatal("Windows reserved project was created")
	}
}

func TestPlanTitleRenameHandlesCollisionsAndCaseChanges(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("hello.md", "# hello\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Target.md", "# Target\n"); err != nil {
		t.Fatal(err)
	}

	casePath, changed, err := v.PlanTitleRename("hello.md", "Hello")
	if err != nil {
		t.Fatal(err)
	}
	if !changed || casePath != "Hello.md" {
		t.Fatalf("case-only plan = %q, %v; want Hello.md, true", casePath, changed)
	}
	if err := v.Rename("hello.md", casePath); err != nil {
		t.Fatal(err)
	}

	collisionPath, changed, err := v.PlanTitleRename("Hello.md", "Target")
	if err != nil {
		t.Fatal(err)
	}
	if !changed || collisionPath != "Target 2.md" {
		t.Fatalf("collision plan = %q, %v; want Target 2.md, true", collisionPath, changed)
	}
}

func TestRootDashboardsAndSidebarTree(t *testing.T) {
	v := openTestVault(t)
	if err := os.MkdirAll(filepath.Join(v.Root, "Projects"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(v.Root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(v.Root, "NODE_MODULES"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Projects/hidden.md", "# Hidden\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("loose.md", "# Loose\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsureRootDashboards(); err != nil {
		t.Fatal(err)
	}
	dashboard, err := v.Read("Projects/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.Markdown != "# Projects\n\n" {
		t.Fatalf("dashboard content = %q", dashboard.Markdown)
	}
	if _, err := os.Stat(filepath.Join(v.Root, "assets", "dashboard.md")); !os.IsNotExist(err) {
		t.Fatal("internal assets folder received a dashboard")
	}
	if _, err := os.Stat(filepath.Join(v.Root, "NODE_MODULES", "dashboard.md")); !os.IsNotExist(err) {
		t.Fatal("node_modules folder received a dashboard")
	}

	nodes, err := v.SidebarTree()
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 {
		t.Fatalf("sidebar nodes = %#v", nodes)
	}
	if !nodes[0].IsDir || nodes[0].Path != "Projects" ||
		nodes[0].EntryPath != "Projects/dashboard.md" || len(nodes[0].Children) != 0 {
		t.Fatalf("folder sidebar node = %#v", nodes[0])
	}
	if nodes[1].IsDir || nodes[1].Path != "loose.md" {
		t.Fatalf("loose note sidebar node = %#v", nodes[1])
	}
}

func TestExistingDashboardCaseIsPreservedAndNeverTitleRenamed(t *testing.T) {
	v := openTestVault(t)
	if err := os.MkdirAll(filepath.Join(v.Root, "Area"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Area/Dashboard.md", "# Custom\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsureRootDashboards(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(v.Root, "Area"))
	if err != nil {
		t.Fatal(err)
	}
	dashboards := 0
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), "dashboard.md") {
			dashboards++
		}
	}
	if dashboards != 1 {
		t.Fatalf("dashboard file count = %d", dashboards)
	}
	path, changed, err := v.PlanTitleRename("Area/Dashboard.md", "Renamed")
	if err != nil {
		t.Fatal(err)
	}
	if changed || path != "Area/Dashboard.md" {
		t.Fatalf("dashboard rename plan = %q, %v", path, changed)
	}
}

func TestFavoritesPersistReorderAndFollowRenames(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("Area/one.md", "# One\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.Write("Area/two.md", "# Two\n"); err != nil {
		t.Fatal(err)
	}
	if err := v.SetFavorite("Area/one.md", true); err != nil {
		t.Fatal(err)
	}
	if err := v.SetFavorite("Area/two.md", true); err != nil {
		t.Fatal(err)
	}
	if err := v.ReorderFavorites([]string{"Area/two.md", "Area/one.md"}); err != nil {
		t.Fatal(err)
	}
	favorites, err := v.Favorites()
	if err != nil {
		t.Fatal(err)
	}
	if len(favorites) != 2 || favorites[0].Path != "Area/two.md" ||
		favorites[1].Path != "Area/one.md" {
		t.Fatalf("favorite order = %#v", favorites)
	}
	if err := v.Rename("Area", "Archive"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenameFavoritePath("Area", "Archive", true); err != nil {
		t.Fatal(err)
	}
	favorites, err = v.Favorites()
	if err != nil {
		t.Fatal(err)
	}
	if favorites[0].Path != "Archive/two.md" || favorites[1].Path != "Archive/one.md" {
		t.Fatalf("favorites did not follow folder rename: %#v", favorites)
	}
	if err := v.RemoveFavoritePath("Archive/two.md", false); err != nil {
		t.Fatal(err)
	}
	favorites, err = v.Favorites()
	if err != nil {
		t.Fatal(err)
	}
	if len(favorites) != 1 || favorites[0].Path != "Archive/one.md" {
		t.Fatalf("favorite removal = %#v", favorites)
	}
}
