# Rockion — Architecture

A local-first markdown editor: **Notion's UI, Obsidian's files.** Every page is a plain
`.md` file on disk inside a *vault* (a folder). The app never holds your data hostage — the
Markdown is the source of truth; SQLite is a disposable, rebuildable index for speed.

Single Go binary (via Wails) wrapping a React + TipTap frontend. Targets thousands of pages
without lag.

---

## 1. Core principles

1. **Files are the source of truth.** `.md` files on disk. Delete the app, your notes remain.
2. **SQLite is a cache, not a database of record.** It indexes files for search, backlinks,
   and fast tree loading. It can be deleted and rebuilt from the vault at any time.
3. **The editor reads/writes Markdown.** TipTap's document model serializes to GitHub-Flavored
   Markdown. No proprietary block format on disk.
4. **Everything is local.** No server, no account. Sync is out of scope for v1 (the user can
   point the vault at a Dropbox/iCloud/Git folder and get sync "for free").

---

## 2. High-level shape

```
┌───────────────────────────────────────────────┐
│                Wails desktop window            │
│  ┌─────────────────────────────────────────┐  │
│  │  React + TipTap frontend (webview)       │  │
│  │  - Sidebar vault tree                    │  │
│  │  - TipTap editor (slash, tables, tasks)  │  │
│  │  - Command palette / quick switcher      │  │
│  └───────────────┬─────────────────────────┘  │
│      Wails bindings (Go methods → JS)          │
│  ┌───────────────▼─────────────────────────┐  │
│  │  Go backend                              │  │
│  │  vault · db(SQLite) · search · indexer   │  │
│  │  fswatcher · media                       │  │
│  └───────────────┬─────────────────────────┘  │
└──────────────────┼─────────────────────────────┘
                   ▼
        Vault folder on disk (.md + assets/ + .rockion/index.db)
```

---

## 3. Backend (Go)

### Packages

| Package    | Responsibility |
|------------|----------------|
| `app`      | Wails app lifecycle, holds service handles, exposes bound methods to JS. |
| `vault`    | Open/create a vault, resolve paths, safe read/write of `.md`, move/rename/delete, list tree. |
| `db`       | SQLite connection, migrations, schema. Uses `modernc.org/sqlite` (pure Go, no cgo → easy cross-compile). |
| `indexer`  | Walks the vault, parses frontmatter + links, upserts rows into SQLite. Incremental on file change. |
| `search`   | Full-text search via SQLite FTS5; title/path search; backlink queries. |
| `fswatcher`| `fsnotify` watcher → debounced reindex of changed files → emits events to frontend. |
| `media`    | Copy/resolve images & attachments into `assets/`, rewrite relative links. |

### Why these choices

- **`modernc.org/sqlite`** (pure Go) over `mattn/go-sqlite3` (cgo): keeps the build a single
  static binary and trivially cross-compiles. FTS5 is available.
- **Wails v2** over a raw `embed.FS` + browser: gives a real native window, native menus,
  file dialogs, and Go↔JS bindings without running a localhost HTTP server.

### Data model (SQLite — the index)

```sql
-- A note = one markdown file.
CREATE TABLE notes (
  id          INTEGER PRIMARY KEY,
  path        TEXT UNIQUE NOT NULL,   -- relative to vault root, e.g. "Projects/Rockion.md"
  title       TEXT NOT NULL,          -- frontmatter title || H1 || filename
  modified_at INTEGER NOT NULL,       -- unix mtime, used for incremental indexing
  size        INTEGER NOT NULL,
  frontmatter TEXT                    -- raw YAML as JSON blob
);

-- Full-text search over note body.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body, content=''            -- external-content-less; we feed it directly
);

-- [[wikilinks]] and [md](links) between notes, for backlinks panel.
CREATE TABLE links (
  source_id  INTEGER NOT NULL,        -- note that contains the link
  target_path TEXT NOT NULL,          -- resolved (or unresolved) target
  kind       TEXT NOT NULL,           -- 'wikilink' | 'markdown'
  FOREIGN KEY(source_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX idx_links_target ON links(target_path);

-- Tags parsed from #hashtags and frontmatter `tags:`.
CREATE TABLE tags (
  note_id INTEGER NOT NULL,
  tag     TEXT NOT NULL,
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX idx_tags_tag ON tags(tag);
```

The index lives at `<vault>/.rockion/index.db`. Deleting it triggers a full rebuild on next
open. Nothing here is irreplaceable.

### Incremental indexing

On open, walk the tree and compare each file's `mtime`/`size` against the `notes` row. Only
changed/new/deleted files are reparsed. `fswatcher` keeps it live while the app runs (and
catches external edits made by Obsidian, git pull, etc.). Reindex is debounced (~300 ms) so a
burst of writes coalesces.

### Bound methods (Go → JS API)

These are the methods Wails exposes to the frontend (all return JSON-friendly structs):

```
OpenVault(path string) (VaultInfo, error)
PickVault() (VaultInfo, error)            // native folder dialog
ListTree() ([]TreeNode, error)
ReadNote(path string) (Note, error)        // returns markdown + parsed frontmatter
WriteNote(path, markdown string) error     // debounced autosave target
CreateNote(dir, title string) (Note, error)
RenamePath(old, new string) error          // updates links across vault
DeletePath(path string) error
Search(query string, limit int) ([]SearchHit, error)
Backlinks(path string) ([]SearchHit, error)
SaveImage(path string, data []byte) (string, error)  // returns vault-relative asset path
```

Events emitted Go → JS: `vault:changed` (file changed externally), `index:progress`.

---

## 4. Frontend (React + Vite + TS + TipTap)

### Editor

TipTap (ProseMirror) is the editor core. The on-disk format is Markdown, so we need a
**Markdown ⟷ ProseMirror** bridge:

- **Load:** parse `.md` → HTML/PM doc. Use `marked` (or `remark`) → TipTap `setContent`.
- **Save:** serialize the PM doc → Markdown. Use a serializer (`prosemirror-markdown` or
  `tiptap-markdown`) so what lands on disk stays clean, diff-friendly Markdown.

> Decision: use **`tiptap-markdown`** for round-tripping — it plugs into TipTap directly and
> handles GFM tables, task lists, and frontmatter passthrough, minimizing custom glue.

### Extensions enabled (the "blocks")

- StarterKit (paragraph, headings, lists, blockquote, code block, bold/italic…)
- `@tiptap/extension-task-list` + `task-item` → checklists (`- [ ]`)
- `@tiptap/extension-table` (+ row/cell/header) → tables
- `@tiptap/extension-image` → images (drag-drop / paste → `SaveImage` → relative link)
- `@tiptap/extension-link`
- Custom **slash command** extension (`/heading`, `/table`, `/todo`, `/image`, `/divider`…),
  a Notion-style menu rendered via a suggestion popup (tippy.js).
- Custom **wikilink** node for `[[Page]]` with autocomplete from the note index.

### UI layout

```
┌──────────┬──────────────────────────────┐
│ Sidebar  │  Editor pane                 │
│  vault   │   - breadcrumb / title        │
│  tree    │   - TipTap content            │
│  search  │                               │
│          │  Backlinks (collapsible)      │
└──────────┴──────────────────────────────┘
```

- **Cmd/Ctrl+P** quick switcher (fuzzy file open).
- **Cmd/Ctrl+K** command palette.
- Notion aesthetic: generous whitespace, hover handles, drag affordances, light/dark.

### State & saving

- Active note content held in React state; **debounced autosave** (~600 ms idle) calls
  `WriteNote`. No save button.
- Tree + search results come from the Go backend; the frontend caches lightly and refreshes on
  `vault:changed` events.

---

## 5. Repository layout

```
rockion/
├── ARCHITECTURE.md          ← this file
├── README.md                ← build & run
├── wails.json               ← Wails project config
├── go.mod / go.sum
├── main.go                  ← Wails entrypoint
├── app.go                   ← App struct + bound methods
├── internal/
│   ├── vault/vault.go
│   ├── db/db.go  db/schema.sql
│   ├── indexer/indexer.go
│   ├── search/search.go
│   └── model/model.go       ← shared structs (Note, TreeNode, SearchHit…)
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts            ← thin wrapper over generated Wails bindings
        ├── components/
        │   ├── Sidebar.tsx
        │   ├── Editor.tsx
        │   ├── Backlinks.tsx
        │   └── QuickSwitcher.tsx
        ├── editor/
        │   ├── extensions.ts
        │   ├── SlashCommand.ts
        │   └── slashItems.ts
        └── styles.css
```

---

## 6. Performance notes (thousands of pages)

- The sidebar tree loads from SQLite, not by walking the FS each render.
- Search is FTS5 — sub-millisecond for typical vaults; results paginated.
- Only the open note is parsed into the editor; everything else stays as rows.
- Indexing is incremental + debounced; first-open of a large vault shows `index:progress`.
- `modernc.org/sqlite` keeps everything in-process — no IPC, no network.

---

## 7. Deliberately out of scope for v1

Real-time collaboration, end-to-end sync, plugins/extensions API, graph view, mobile,
encryption-at-rest. The architecture leaves room for each (the index already tracks links for
a future graph view; bindings are the natural seam for a plugin host).
