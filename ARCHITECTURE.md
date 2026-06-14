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
        Vault folder on disk (.md + assets/ + .rockion metadata)
```

---

## 3. Backend (Go)

### Packages

| Package    | Responsibility |
|------------|----------------|
| `app*.go`  | Wails lifecycle and bound APIs, split into core notes, dashboards, media, transfer, and watcher modules. |
| `vault`    | Open/create a vault, resolve paths, safe read/write of `.md`, move/rename/delete, list tree. |
| `db`       | SQLite connection, migrations, schema. Uses `modernc.org/sqlite` (pure Go, no cgo → easy cross-compile). |
| `indexer`  | Walks the vault, parses frontmatter + links, upserts rows into SQLite. Incremental on file change. |
| `search`   | Full-text search via SQLite FTS5; title/path search; backlink queries. |
| `app_watcher.go` | Recursive `fsnotify` watcher → per-path debounced reindex → frontend events. |
| `vault` media | Validates decoded image bytes, caps size/dimensions, and writes into `assets/`. |
| `vault` covers | Stores page cover metadata in `.rockion/covers.json`; validates generated styles and local uploaded assets. |
| `vault` dashboard views | Stores layout and sort preferences in `.rockion/dashboard-views.json` without rewriting Markdown frontmatter. |

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

On open, the disposable index is rebuilt from all supported Markdown files. While the app runs,
recursive `fsnotify` watches keep it current. Events are debounced independently per path so a
burst affecting multiple notes does not discard earlier events. Folder operations reconcile full
subtrees.

### Bound methods (Go → JS API)

These are the methods Wails exposes to the frontend (all return JSON-friendly structs):

```
OpenVault(path string) (VaultInfo, error)
PickVault() (VaultInfo, error)            // native folder dialog
ListTree() ([]TreeNode, error)
ReadNote(path string) (Note, error)        // returns markdown + parsed frontmatter
WriteNote(path, markdown, version string) (Note, error) // conflict-checked autosave
CreateProject(title string) (Note, error)    // root folder + dashboard.md
CreateSubPage(dashboard, title string) (Note, error) // managed project page
ListDashboardCards(dashboard string) ([]PageCard, error)
GetDashboardView(dashboard string) (DashboardView, error)
SetDashboardView(dashboard string, view DashboardView) error
ReorderManagedPages(dashboard string, pageIDs []string) error
RenamePath(old, new string) error          // updates links, icons, and index
DeletePath(path string) error
DeleteManagedPage(dashboard, href, version string) (Note, error)
Search(query string, limit int) ([]SearchHit, error)
Backlinks(path string) ([]SearchHit, error)
SaveImage(path string, data []byte) (string, error)  // returns vault-relative asset path
SetNoteCover(path string, cover PageCover) (Note, error)
CoverImageDataURL(path string) (string, error) // validated local cover for webview
CoverThumbnailDataURL(path string) (string, error) // bounded dashboard thumbnail
```

Project pages remain ordinary Markdown files. Rockion stores a stable
`rockion_id` in each page's YAML frontmatter and adds that ID to its dashboard
link query. This lets links follow title and filename changes without a
proprietary dashboard format. Custom link labels remain unchanged. Removing a
managed link in the editor restores it on save; deleting its linked page uses
the dashboard card action so the link and file are removed together.

Dashboard layout and sorting are not stored in Markdown frontmatter. They live
in `.rockion/dashboard-views.json`; legacy frontmatter settings are read for
compatibility but are never rewritten. Manual card order remains the order of
managed links in `dashboard.md`, while title/date sorting is derived in the UI
and disables drag reordering.

Page covers do not modify Markdown. Their metadata is stored in the exported
vault under `.rockion/covers.json`, while uploaded cover images live in
`assets/`. Solid colors and gradients are generated locally.

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
- A top breadcrumb history shows live page icons and titles; clicking an
  earlier item truncates the trail and navigates back to that page.
- Notion aesthetic: generous whitespace, hover handles, drag affordances, light/dark.

### State & saving

- Active note content uses **debounced autosave** (~600 ms idle). Navigation flushes pending text,
  writes compare a SHA-256 content version, and external dirty conflicts require an explicit reload
  or overwrite decision.
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
├── app.go                   ← App struct, lifecycle, and core note methods
├── app_dashboard.go         ← dashboard + managed-page methods
├── app_media.go             ← image, cover, icon, and file methods
├── app_transfer.go          ← encrypted vault import/export
├── app_watcher.go           ← recursive watcher + debounce
├── internal/
│   ├── vault/               ← split filesystem, assets, dashboards, covers, icons
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
        │   ├── Dashboard.tsx
        │   ├── DashboardCards.tsx
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

- The sidebar tree is built from the filesystem on refresh; search and backlinks load from SQLite.
- Search is FTS5 — sub-millisecond for typical vaults; results paginated.
- Only the open note is parsed into the editor; everything else stays as rows.
- Indexing is incremental + debounced; first-open of a large vault shows `index:progress`.
- `modernc.org/sqlite` keeps everything in-process — no IPC, no network.

---

## 7. Deliberately out of scope for v1

Real-time collaboration, built-in sync, plugins/extensions API, graph view, mobile, and
encryption-at-rest. A future plugin host must be permission-scoped; Wails bindings must not be
exposed wholesale to untrusted plugin code.
