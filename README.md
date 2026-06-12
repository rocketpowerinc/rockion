# Rockion

A local-first markdown editor — **Notion's UI, Obsidian's files.** Every page is a plain
`.md` file inside a vault folder you choose. SQLite is used only as a rebuildable search index;
your Markdown is always the source of truth.

Single Go binary (Wails) wrapping a React + TipTap editor.

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Features

**Editing**

- TipTap editor that reads/writes GitHub-Flavored Markdown directly to disk, with debounced autosave (no save button).
- Notion-style `/` slash menu: headings, lists, to-dos, table, quote, **callout**, **link to page**, code block, divider.
- **Block handles** — hover any block for a drag grip (reorder via drag) and a `+` button (insert a block below). Nested blocks (incl. callouts inside callouts) can be dragged out.
- Click the empty area below the content to start a new block.
- Tables, checklists, and image paste/drop (images saved into the vault's `assets/`).

**Callouts** — a single `/Callout` block; click its icon to cycle three cyberpunk gradient styles (green / red / yellow). On disk it's a portable `> [!GREEN]` alert blockquote.

**Code blocks** — syntax highlighting (highlight.js) with a hover toolbar in the top-right: a language dropdown (Plain text, PowerShell, Bash, Python, Go, Markdown), a **Copy** button, and a **Download** button that opens a native Save dialog and writes the script with the right extension. Defaults to plain text; stays a portable fenced block on disk.

**Pages & links**

- Each page has an icon — pick an **emoji** or **upload a custom image** (resized and stored as a data URL in the icons sidecar). Set it from the icon at the top of a note or in the sidebar.
- `/Link to page` inserts a plain `[Title](path.md)` markdown link. In the editor it renders Notion-style: the **target page's icon with a small ↗ badge**, no underline. The icon is resolved live from the page's current icon (change a page's icon and its links follow), and nothing extra is written to disk.
- Backlinks panel shows everything that links to the current note.

**Workspace**

- Open any folder as a vault; sidebar file tree with icons.
- Full-text search + quick switcher (`Cmd/Ctrl+P`).
- Light / dark theme toggle (persisted; defaults to your OS preference).
- Live re-index on external edits (edit a file in Obsidian/git and the app updates).

## Download

Grab a prebuilt binary from the [Releases](https://github.com/rocketpowerinc/rockion/releases) page:

- **Windows x64** - `rockion-windows-amd64-installer.exe` or portable `.exe`
- **Windows ARM64** - `rockion-windows-arm64-installer.exe` or portable `.exe`
- **macOS Intel** - `rockion-macos-amd64.zip`
- **macOS Apple Silicon** - `rockion-macos-arm64.zip`
- **Linux x64** - `rockion-linux-amd64.tar.gz`
- **Linux ARM64** - `rockion-linux-arm64.tar.gz`

See the [CHANGELOG](./CHANGELOG.md) for what's in each release.

## Prerequisites

- **Go** 1.26.4
- **Node** 20.19+ or 22.12+
- **Wails CLI v2.12.0**: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`
- Platform deps for Wails (WebView2 on Windows, WebKit on Linux). Run `wails doctor` to check.

## Develop

```bash
# from the repo root
wails dev
```

`wails dev` generates the Go↔JS bindings into `frontend/wailsjs/`, installs frontend deps,
starts Vite, and opens the desktop window with hot reload.

> The first time you build, Wails generates `frontend/wailsjs/` and `frontend/dist/`. These are
> git-ignored and regenerated on every build — the `frontend/dist/.gitkeep` placeholder only
> exists so the `//go:embed` directive compiles before the first build.

## Build a release binary

```bash
wails build
# output: build/bin/rockion(.exe)
```

## Cutting a release

Run the Windows release coordinator:

```powershell
.\dev\windows-create-release.ps1
```

It updates version metadata and the changelog, runs the full Go/frontend/security
suite, creates the release commit and tag, builds a local Windows smoke artifact,
then pushes the tag. GitHub Actions builds native Windows x64/ARM64, macOS
Intel/Apple Silicon, and Linux x64/ARM64 packages with SHA-256 checksums.

After all six platform builds and checksum generation succeed, the resulting
GitHub release is published automatically. See [dev/README.md](./dev/README.md)
for local-only and no-wait options.

The app icon comes from `build/appicon.png`; Wails regenerates platform icon formats
during native builds.

## How it works

1. Launch → "Open a vault folder" → pick any directory of `.md` files.
2. Rockion indexes it in the background (`.rockion/index.db`) and watches for changes.
3. Click a note to edit; type `/` for blocks; `Cmd/Ctrl+P` to jump anywhere.

Deleting `.rockion/` is always safe — it rebuilds from your files on next open.

## How it works under the hood

**Core principle: your `.md` files are the source of truth.** Everything Rockion adds is either
derived (the SQLite index) or stored in a sidecar — the markdown files only ever contain portable
markdown.

**Backend (Go, in `internal/` + `app.go`)**

- `vault` — opens a folder, reads/writes notes, builds the sidebar tree. On read it splits YAML
  frontmatter from the body and derives a title (frontmatter `title` → first `# H1` → filename).
  Frontmatter is preserved byte-for-byte on save. Path handling rejects root targets, traversal,
  symlinks, and unsupported note extensions.
- `db` — opens `<vault>/.rockion/index.db` using **`modernc.org/sqlite`** (pure Go, no cgo → single
  static binary, easy cross-compile). Pragmas and schema are applied statement-by-statement.
- `indexer` — walks `.md`, `.markdown`, and `.mdx` files, parsing `[[wikilinks]]`, `[md](links)`,
  frontmatter tags, and `#tags` into the DB and feeding an **FTS5** full-text table. Incremental
  mutations are serialized and folder deletes remove the full indexed subtree.
- `search` — FTS5 queries (prefix match on the last term) and backlink lookups. Slice results are
  always returned as `[]T{}` (never nil) so the JSON never serializes to `null`.
- `app.go` — the Wails binding layer: every method here is callable from JS (`OpenVault`,
  `ReadNote`, `WriteNote`, `Search`, `Backlinks`, `SaveImage`, `SaveFile`, `SetNoteIcon`, …). A
  recursive, per-path-debounced `fsnotify` watcher reflects external edits and emits events to the UI.

**Frontend (React + Vite + TS + TipTap, in `frontend/src/`)**

- The editor is **TipTap/ProseMirror**. `tiptap-markdown` round-trips the document to/from
  GitHub-Flavored Markdown, so what lands on disk is clean, diff-friendly markdown.
- Custom extensions live in `src/editor/`:
  - `Callout` — a node that serializes to `> [!TYPE]` and parses it back via a small markdown-it
    rule; its node view renders the clickable color-cycling icon.
  - `CodeBlock` — extends `code-block-lowlight`; a node view adds the language/copy/download toolbar.
  - `SlashCommand` — the `/` menu (positioned manually, no popper dependency).
  - `AddBlockButton` — the gutter `+`, anchored to the drag grip so spacing is consistent.
  - Drag-to-reorder is `tiptap-extension-global-drag-handle` (zero deps).
- **Saving** is debounced autosave with flush-before-navigation. Each write includes the SHA-256
  version last read from disk. External changes reload clean notes automatically; dirty conflicts
  pause autosave and require an explicit choice. Notes and sidecars use atomic replacement writes.
- **Page icons** are stored in a sidecar `<vault>/.rockion/icons.json` (path → emoji), so picking an
  icon never rewrites your markdown. The tree and link picker read icons from there.
- **Page links** are plain markdown links. The icon + ↗ badge are added by a ProseMirror
  *decoration* (`PageLinkDecorations`) that looks up the target's icon from a live registry
  (`pageIcons.ts`) — so nothing is baked into the file and link icons update when a page's icon
  changes. Clicking a link (or its icon) opens that note instead of navigating.
- **Custom image icons** are read in the browser, resized to 64px on a canvas, and stored as a
  `data:` URL in `icons.json` — no backend image handling, and they render anywhere an icon shows.
- **Theme** is a `data-theme` attribute on `<html>` (set before first paint by an inline script in
  `index.html`, persisted to `localStorage`).

The index and sidecars all live under `<vault>/.rockion/` and are disposable — delete the folder
and Rockion rebuilds it (you'd only lose page icons, which are cosmetic).

## Project layout

```
rockion/
├── main.go  app.go           ← Wails entrypoint + bound API methods (JS-callable)
├── internal/
│   ├── vault/                ← file read/write, tree, frontmatter, icons.json sidecar
│   ├── db/                   ← SQLite index (modernc, pure Go) + schema
│   ├── indexer/              ← incremental parse: links, tags, FTS
│   ├── search/               ← FTS5 search + backlinks
│   └── model/                ← shared structs
├── build/                    ← appicon.png + generated Windows icon/installer config
└── frontend/                 ← React + Vite + TS + TipTap
    ├── public/               ← Rockion-Hero.png (welcome-screen branding)
    └── src/
        ├── api.ts            ← typed wrapper over the generated Wails bindings
        ├── App.tsx           ← layout, theme, vault/note state, page list
        ├── editor/
        │   ├── extensions.ts ← the full TipTap extension set
        │   ├── Callout.ts    ← callout node + markdown round-trip + color cycle
        │   ├── CodeBlock.ts  ← lowlight code block + language/copy/download toolbar
        │   ├── SlashCommand.ts / SlashMenu.tsx / slashItems.ts
        │   └── AddBlockButton.ts  ← gutter "+" button
        └── components/       ← Sidebar, Editor, Backlinks, QuickSwitcher,
                                 PagePicker, EmojiPicker, ErrorBoundary
```

## Roadmap (not yet built)

Wikilink (`[[ ]]`) autocomplete, a graph view (the link index already tracks everything needed),
drag-to-reorder in the sidebar tree, a tag browser, history/recovery UI, and a permission-scoped
plugin host. See the end of [ARCHITECTURE.md](./ARCHITECTURE.md).
