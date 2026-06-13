package vaultbackup

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestExportImportRoundTrip(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".rockion"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "note.md"), []byte("# Hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".rockion", "icons.json"), []byte(`{"folder/note.md":"X"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".rockion", "index.db"), []byte("generated"), 0o644); err != nil {
		t.Fatal(err)
	}

	archive := filepath.Join(t.TempDir(), "vault.rockion")
	if err := Export(root, archive, "correct horse battery staple"); err != nil {
		t.Fatal(err)
	}
	importParent := t.TempDir()
	imported, err := Import(archive, importParent, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	note, err := os.ReadFile(filepath.Join(imported, "folder", "note.md"))
	if err != nil || string(note) != "# Hello\n" {
		t.Fatalf("note was not restored: %q, %v", note, err)
	}
	if _, err := os.Stat(filepath.Join(imported, ".rockion", "icons.json")); err != nil {
		t.Fatalf("icon metadata was not restored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(imported, ".rockion", "index.db")); !os.IsNotExist(err) {
		t.Fatal("generated search index should not be exported")
	}
}

func TestImportRejectsWrongPasswordAndTampering(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("# Secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "vault.rockion")
	if err := Export(root, archive, "correct password"); err != nil {
		t.Fatal(err)
	}
	if _, err := Import(archive, t.TempDir(), "incorrect password"); err == nil {
		t.Fatal("wrong password was accepted")
	}

	data, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 0xff
	if err := os.WriteFile(archive, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Import(archive, t.TempDir(), "correct password"); err == nil {
		t.Fatal("tampered archive was accepted")
	}
}

func TestExportRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "note.md")
	if err := os.WriteFile(target, []byte("# Note\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "alias.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := Export(root, filepath.Join(t.TempDir(), "vault.rockion"), "correct password"); err == nil {
		t.Fatal("vault containing a symlink was exported")
	}
}

func TestImportRejectsPathTraversal(t *testing.T) {
	var plaintext bytes.Buffer
	writer := zip.NewWriter(&plaintext)
	if err := writer.SetComment(`{"version":1,"vaultName":"Unsafe"}`); err != nil {
		t.Fatal(err)
	}
	entry, err := writer.Create("../outside.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("# Outside\n")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	archive := filepath.Join(t.TempDir(), "unsafe.rockion")
	output, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := encryptStream(output, bytes.NewReader(plaintext.Bytes()), "correct password"); err != nil {
		_ = output.Close()
		t.Fatal(err)
	}
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()
	if _, err := Import(archive, parent, "correct password"); err == nil {
		t.Fatal("path traversal archive was accepted")
	}
	if _, err := os.Stat(filepath.Join(parent, "outside.md")); !os.IsNotExist(err) {
		t.Fatal("path traversal wrote outside the import folder")
	}
}
