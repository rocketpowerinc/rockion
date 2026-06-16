package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rockion/internal/db"
	"rockion/internal/indexer"
	"rockion/internal/vault"
)

func TestKeyedDebouncerKeepsIndependentPaths(t *testing.T) {
	debouncer := newKeyedDebouncer(10 * time.Millisecond)
	var first, second atomic.Int32
	debouncer.Do("a.md", func() { first.Add(1) })
	debouncer.Do("b.md", func() { second.Add(1) })
	debouncer.Do("a.md", func() { first.Add(1) })
	time.Sleep(40 * time.Millisecond)
	debouncer.Close()
	if first.Load() != 1 || second.Load() != 1 {
		t.Fatalf("events were dropped or duplicated: first=%d second=%d", first.Load(), second.Load())
	}
}

func TestVaultAssetHandlerServesOnlyActiveVaultAssets(t *testing.T) {
	opened, err := vault.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(opened.Root, "Assets", "Videos"), 0o755); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(opened.Root, "Assets", "Videos", "clip.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.vault = opened
	server := httptest.NewServer(app.vaultAssetMiddleware()(http.NotFoundHandler()))
	defer server.Close()

	resp, err := http.Get(server.URL + "/Assets/Videos/clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || string(body) != "video" {
		t.Fatalf("asset response = %d %q", resp.StatusCode, string(body))
	}

	resp, err = http.Get(server.URL + "/Project/page.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-asset path was served: %d", resp.StatusCode)
	}
}

func TestDeletePathRejectsProjectPages(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "Project"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Project", "Page.md"), []byte("# Page\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opened, err := vault.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.vault = opened
	err = app.DeletePath("Project/Page.md")
	if err == nil || !strings.Contains(err.Error(), "dashboard link") {
		t.Fatalf("project page deletion was not rejected: %v", err)
	}
}

func TestRenameToTitleUpdatesManagedLinkWithoutFilenameChange(t *testing.T) {
	opened, err := vault.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := opened.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	page, err := opened.CreateManagedPage("Project/dashboard.md", "Question")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := opened.NormalizeManagedDashboard("Project/dashboard.md"); err != nil {
		t.Fatal(err)
	}
	if err := opened.Write(page.Path, "# Question?\n\n"); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.vault = opened
	renamed, err := app.RenameToTitle(page.Path, "Question?")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Path != page.Path {
		t.Fatalf("title with equivalent sanitized filename moved page to %q", renamed.Path)
	}
	dashboard, err := opened.Read("Project/dashboard.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dashboard.Markdown, "[Question?](Other/Question.md?") {
		t.Fatalf("managed dashboard label was not updated: %q", dashboard.Markdown)
	}
}

func TestReplaceFirstHeadingPreservesDashboardBody(t *testing.T) {
	got := replaceFirstHeading("# Old\r\n\r\nKeep this.\r\n", "New")
	want := "# New\r\n\r\nKeep this.\r\n"
	if got != want {
		t.Fatalf("dashboard heading replacement changed the body:\n got %q\nwant %q", got, want)
	}

	got = replaceFirstHeading("No heading\n", "New")
	want = "# New\n\nNo heading\n"
	if got != want {
		t.Fatalf("missing dashboard heading was not inserted:\n got %q\nwant %q", got, want)
	}
}

func TestRenameProjectMovesFolderAndUpdatesDashboardTitle(t *testing.T) {
	opened, err := vault.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := opened.CreateProject("Old Project"); err != nil {
		t.Fatal(err)
	}
	database, err := db.Open(opened.Root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	ix := indexer.New(opened, database)
	if err := ix.Rebuild(); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.vault = opened
	app.db = database
	app.indexer = ix
	renamed, err := app.RenameProject("Old Project/dashboard.md", "New Project")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Path != "New Project/dashboard.md" || renamed.Title != "New Project" {
		t.Fatalf("renamed dashboard = %#v", renamed)
	}
	if _, err := os.Stat(filepath.Join(opened.Root, "Old Project")); !os.IsNotExist(err) {
		t.Fatalf("old project still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(opened.Root, "New Project", "dashboard.md")); err != nil {
		t.Fatalf("renamed dashboard missing: %v", err)
	}
}

func TestKeyedDebouncerCloseCancelsPendingWork(t *testing.T) {
	debouncer := newKeyedDebouncer(time.Second)
	var called atomic.Bool
	debouncer.Do("note.md", func() { called.Store(true) })
	debouncer.Close()
	if called.Load() {
		t.Fatal("pending callback ran after close")
	}
}
