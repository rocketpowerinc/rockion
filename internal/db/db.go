package db

import (
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

// DB wraps the SQLite index connection.
type DB struct {
	*sql.DB
	Path string
}

// Open opens (creating if needed) the index database at <vaultDir>/.rockion/index.db.
func Open(vaultDir string) (*DB, error) {
	dir := filepath.Join(vaultDir, ".rockion")
	if info, err := os.Lstat(dir); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, errors.New(".rockion must be a real directory inside the vault")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect .rockion dir: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create .rockion dir: %w", err)
	}
	path := filepath.Join(dir, "index.db")
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("index database cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect index database: %w", err)
	}

	// Use the plain path as the DSN (no query string — Windows paths like
	// C:\... don't survive URL/query parsing reliably) and set pragmas after.
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Single connection keeps modernc's in-process SQLite simple and avoids
	// "database is locked" across goroutines.
	conn.SetMaxOpenConns(1)
	for _, p := range []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA busy_timeout=5000;",
	} {
		if _, err := conn.Exec(p); err != nil {
			conn.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}
	// Apply schema one statement at a time (don't rely on multi-statement Exec).
	for _, stmt := range splitStatements(schema) {
		if _, err := conn.Exec(stmt); err != nil {
			conn.Close()
			return nil, fmt.Errorf("apply schema: %w", err)
		}
	}
	return &DB{DB: conn, Path: path}, nil
}

// Reset drops all indexed rows so a full rebuild can run.
func (d *DB) Reset() error {
	for _, stmt := range []string{
		"DELETE FROM notes;",
		"DELETE FROM notes_fts;",
		"DELETE FROM links;",
		"DELETE FROM tags;",
	} {
		if _, err := d.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// splitStatements splits a SQL script into individual statements on ';',
// stripping line comments and blank statements. Sufficient for our schema.
func splitStatements(script string) []string {
	var out []string
	for _, raw := range strings.Split(script, ";") {
		var b strings.Builder
		for _, line := range strings.Split(raw, "\n") {
			if i := strings.Index(line, "--"); i >= 0 {
				line = line[:i]
			}
			b.WriteString(line)
			b.WriteString("\n")
		}
		if strings.TrimSpace(b.String()) != "" {
			out = append(out, b.String())
		}
	}
	return out
}
