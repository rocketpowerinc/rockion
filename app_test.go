package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
	if !strings.Contains(dashboard.Markdown, "[Question?](Question.md?") {
		t.Fatalf("managed dashboard label was not updated: %q", dashboard.Markdown)
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
