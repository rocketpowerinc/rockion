package vault

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecordHistorySnapshotDedupeAndRead(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("Project/page.md", "# Page\n\nfirst\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.RecordHistorySnapshot("Project/page.md", "# Page\n\nfirst\n", "save"); err != nil {
		t.Fatal(err)
	}
	if version, err := v.RecordHistorySnapshot("Project/page.md", "# Page\n\nfirst\n", "save"); err != nil {
		t.Fatal(err)
	} else if version != nil {
		t.Fatal("duplicate consecutive snapshot was not skipped")
	}
	if version, err := v.RecordHistorySnapshot("Project/page.md", "# Page\n\nsecond\n", "save"); err != nil {
		t.Fatal(err)
	} else if version != nil {
		t.Fatal("rapid save snapshot was not throttled")
	}
	if _, err := v.RecordHistorySnapshot("Project/page.md", "# Page\n\nsecond\n", "delete"); err != nil {
		t.Fatal(err)
	}
	versions, err := v.ListPageHistory("Project/page.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(versions))
	}
	body, err := v.ReadHistoryVersion("Project/page.md", versions[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if body != "# Page\n\nfirst\n" {
		t.Fatalf("unexpected snapshot body: %q", body)
	}
}

func TestRenameHistoryPathMovesManifest(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.RecordHistorySnapshot("Old/page.md", "# Page\n", "save"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenameHistoryPath("Old", "New", true); err != nil {
		t.Fatal(err)
	}
	oldVersions, err := v.ListPageHistory("Old/page.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(oldVersions) != 0 {
		t.Fatalf("old history path still returned versions: %d", len(oldVersions))
	}
	newVersions, err := v.ListPageHistory("New/page.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(newVersions) != 1 || newVersions[0].Path != "New/page.md" {
		t.Fatalf("history did not follow rename: %+v", newVersions)
	}
}

func TestRecentAndClearHistory(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.RecordHistorySnapshot("Project/a.md", "# A\n", "save"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.RecordHistorySnapshot("Project/b.md", "# B\n", "save"); err != nil {
		t.Fatal(err)
	}
	recent, err := v.RecentHistory(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 1 {
		t.Fatalf("expected one recent item, got %d", len(recent))
	}
	if err := v.ClearHistory(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(v.Root, ".rockion", "history")); !os.IsNotExist(err) {
		t.Fatalf("history directory was not removed: %v", err)
	}
}
