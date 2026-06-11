# Rockion

A local-first markdown editor — **Notion's UI, Obsidian's files.** Every page is a plain
`.md` file inside a vault folder you choose. SQLite is used only as a rebuildable search index;
your Markdown is always the source of truth.

Single Go binary (Wails) wrapping a React + TipTap editor.

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Features in this scaffold

- Open any folder as a vault; sidebar file tree.
- TipTap editor that reads/writes GitHub-Flavored Markdown on disk.
- Notion-style `/` slash menu (headings, lists, to-dos, table, quote, code, divider).
- Tables, checklists, image paste/drop (saved into `assets/`).
- Full-text search + quick switcher (`Cmd/Ctrl+P`), backlinks panel.
- Live re-index on external edits (edit a file in Obsidian/git and it updates).
- Debounced autosave — no save button.

## Download

Grab a prebuilt binary from the [Releases](https://github.com/rocket/rockion/releases) page:

- **Windows** — `rockion-windows-amd64-installer.exe` (installer, recommended) or `rockion-windows-amd64.exe` (portable, run directly)
- **macOS** — `rockion-macos-universal.zip` (unzip → `Rockion.app`)
- **Linux** — `rockion-linux-amd64.tar.gz` (extract → run `rockion`; needs `libwebkit2gtk-4.0`)

See the [CHANGELOG](./CHANGELOG.md) for what's in each release.

## Prerequisites

- **Go** 1.22+
- **Node** 18+ (Node 22 recommended)
- **Wails CLI v2**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
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

Local builds only produce a binary for the machine you're on — Wails can't
cross-compile to macOS/Linux from Windows. So there are two paths:

**Test locally (Windows .exe, right now):**

```powershell
cd C:\Users\rocket\Github-pwr\rockion
wails build -clean -trimpath
# → build/bin/rockion.exe
```

To also build the Windows **installer** locally, add `-nsis` (requires
[NSIS](https://nsis.sourceforge.io/) on PATH — `choco install nsis`):

```powershell
wails build -clean -trimpath -nsis
# → build/bin/rockion-amd64-installer.exe
```

The app icon comes from `build/appicon.png` — replace that file (1024×1024 PNG)
to rebrand; Wails regenerates the `.ico`/`.icns` on the next build.

**Publish all three platforms (via CI):** push a version tag and GitHub Actions
(`.github/workflows/release.yml`) builds Windows, macOS, and Linux and attaches them
to a draft GitHub Release.

```bash
git add -A
git commit -m "Release v0.1.0"
git tag v0.1.0
git push origin main --tags
```

Then open the repo's Releases page, review the auto-generated draft, and publish.
Bump `productVersion` in `wails.json` and add a `CHANGELOG.md` entry for each release.

## How it works

1. Launch → "Open a vault folder" → pick any directory of `.md` files.
2. Rockion indexes it in the background (`.rockion/index.db`) and watches for changes.
3. Click a note to edit; type `/` for blocks; `Cmd/Ctrl+P` to jump anywhere.

Deleting `.rockion/` is always safe — it rebuilds from your files on next open.

## Project layout

```
rockion/
├── main.go app.go            ← Wails entrypoint + bound API methods
├── internal/
│   ├── vault/                ← file read/write, tree, frontmatter
│   ├── db/                   ← SQLite index (modernc, pure Go) + schema
│   ├── indexer/              ← incremental parse: links, tags, FTS
│   ├── search/               ← FTS5 search + backlinks
│   └── model/                ← shared structs
└── frontend/                 ← React + Vite + TS + TipTap
    └── src/
        ├── editor/           ← extensions + slash command menu
        └── components/       ← Sidebar, Editor, Backlinks, QuickSwitcher
```

## Roadmap (not yet built)

Wikilink autocomplete node, graph view (the link index is already there), drag-to-reorder
tree, tag browser, themes, and a plugin host. See the end of ARCHITECTURE.md.
