-- Rockion index schema. This database is a disposable cache, rebuildable from the vault.

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  path        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  modified_at INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  frontmatter TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  body,
  path UNINDEXED
);

CREATE TABLE IF NOT EXISTS links (
  source_id   INTEGER NOT NULL,
  target_path TEXT NOT NULL,
  kind        TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);

CREATE TABLE IF NOT EXISTS tags (
  note_id INTEGER NOT NULL,
  tag     TEXT NOT NULL,
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
