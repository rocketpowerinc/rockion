# Rockion

A local-first markdown editor — **Notion's UI, Obsidian's files.** Every page is a plain
`.md` file inside a vault folder you choose. SQLite is used only as a rebuildable search index;
your Markdown is always the source of truth.

Single Go binary (Wails) wrapping a React + TipTap editor.

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Install in one command

Each command downloads the requested asset and `SHA256SUMS.txt`, verifies the
asset, and only then installs or runs it. Re-run the command to update.

**AnduinOS / Ubuntu 24.04 (x64)** — downloads to `/tmp` (so apt's `_apt` sandbox
can read it) and installs, pulling in dependencies.

```bash
d="$(mktemp -d /tmp/rockion-install.XXXXXX)" && cd "$d" && curl -fSLO https://github.com/rocketpowerinc/rockion/releases/latest/download/rockion-anduinos-amd64.deb && curl -fSLO https://github.com/rocketpowerinc/rockion/releases/latest/download/SHA256SUMS.txt && grep '  rockion-anduinos-amd64.deb$' SHA256SUMS.txt | sha256sum -c - && chmod 0644 rockion-anduinos-amd64.deb && sudo apt install -y "$d/rockion-anduinos-amd64.deb"
```

This package targets the Ubuntu 24.04 WebKitGTK 4.1 ABI used by AnduinOS; it will
not install on Ubuntu 22.04 or older (which ship WebKitGTK 4.0). Other Linux
distributions are outside the release compatibility guarantee.

**Windows x64 — installer (silent, persistent)** — PowerShell. Approve the UAC
prompt if it appears; SmartScreen may warn since the build is unsigned.

```powershell
$ProgressPreference='SilentlyContinue'; $d=Join-Path $env:TEMP "rockion-install-$([guid]::NewGuid().ToString('N'))"; New-Item -ItemType Directory $d|Out-Null; $a='rockion-windows-amd64-installer.exe'; $b='https://github.com/rocketpowerinc/rockion/releases/latest/download'; Invoke-WebRequest "$b/$a" -OutFile "$d/$a"; Invoke-WebRequest "$b/SHA256SUMS.txt" -OutFile "$d/SHA256SUMS.txt"; $e=((Get-Content "$d/SHA256SUMS.txt"|Where-Object {$_ -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($a))$"}|Select-Object -First 1)-split '\s+')[0]; if(!$e -or (Get-FileHash "$d/$a" -Algorithm SHA256).Hash -ne $e){throw 'Checksum verification failed'}; Start-Process "$d/$a" -ArgumentList '/S' -Wait; Remove-Item $d -Recurse -Force
```

**Windows x64 — portable (no install, download + run):**

```powershell
$ProgressPreference='SilentlyContinue'; $d=Join-Path $env:TEMP "rockion-install-$([guid]::NewGuid().ToString('N'))"; New-Item -ItemType Directory $d|Out-Null; $a='rockion-windows-amd64.exe'; $b='https://github.com/rocketpowerinc/rockion/releases/latest/download'; Invoke-WebRequest "$b/$a" -OutFile "$d/$a"; Invoke-WebRequest "$b/SHA256SUMS.txt" -OutFile "$d/SHA256SUMS.txt"; $e=((Get-Content "$d/SHA256SUMS.txt"|Where-Object {$_ -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($a))$"}|Select-Object -First 1)-split '\s+')[0]; if(!$e -or (Get-FileHash "$d/$a" -Algorithm SHA256).Hash -ne $e){throw 'Checksum verification failed'}; Move-Item "$d/$a" "$env:LOCALAPPDATA\rockion.exe" -Force; Remove-Item $d -Recurse -Force; Start-Process "$env:LOCALAPPDATA\rockion.exe"
```

**macOS (Apple Silicon only)** — unzips into `/Applications`, strips the Gatekeeper
quarantine (the app is unsigned), and launches it. Prefix `sudo unzip` if
`/Applications` isn't writable.

```bash
d="$(mktemp -d /tmp/rockion-install.XXXXXX)" && cd "$d" && curl -fSLO https://github.com/rocketpowerinc/rockion/releases/latest/download/rockion-macos-arm64.zip && curl -fSLO https://github.com/rocketpowerinc/rockion/releases/latest/download/SHA256SUMS.txt && expected="$(awk '$2=="rockion-macos-arm64.zip"{print $1}' SHA256SUMS.txt)" && test "$(shasum -a 256 rockion-macos-arm64.zip | awk '{print $1}')" = "$expected" && unzip -oq rockion-macos-arm64.zip -d /Applications && xattr -dr com.apple.quarantine /Applications/Rockion.app && open /Applications/Rockion.app
```

> These mirror the maintained scripts in `dev/linux/install-latest.sh`,
> `dev/windows/install-latest.ps1`, and `dev/macos/install-latest.sh`.
> Release builds support Windows Authenticode signing and Apple signing/notarization
> when the corresponding repository secrets are configured.

## Uninstall in one command

**AnduinOS / Ubuntu 24.04 (x64)** — removes the package, its desktop entry, and icons:

```bash
sudo apt-get purge -y rockion
```

**Windows x64 — installer build** — PowerShell. Finds the registered uninstaller
and runs it silently; approve the UAC prompt if it appears.

```powershell
$k='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RockionRockion'; if (Test-Path $k) { Start-Process cmd -ArgumentList '/c',(Get-ItemProperty $k).QuietUninstallString -Wait } else { 'Rockion is not installed.' }
```

**Windows x64 — portable build** — just delete the downloaded exe:

```powershell
Remove-Item "$env:LOCALAPPDATA\rockion.exe" -Force
```

**macOS (Apple Silicon):**

```bash
rm -rf /Applications/Rockion.app
```

> These mirror the maintained scripts in `dev/linux/uninstall.sh`,
> `dev/windows/uninstall.ps1`, and `dev/macos/uninstall.sh`.

## Features

**Editing**

- TipTap editor that reads/writes GitHub-Flavored Markdown directly to disk, with debounced autosave (no save button).
- **Title = filename** — edit a note's first `# Heading` and the `.md` file is renamed to match once you pause typing (clashes get a ` 2`, ` 3` suffix; links that point to the page are rewritten).
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

- Open any folder as a vault. Root folders appear as projects in the sidebar and
  open through their `dashboard.md` entry page.
- Favorite pages appear above projects and support drag-to-reorder.
- Project dashboards support gallery/list layouts, sorting, managed-page
  creation, reordering, and deletion.
- Full-text search + quick switcher (`Cmd/Ctrl+P`).
- Light / dark theme toggle (persisted; defaults to your OS preference).
- Live re-index on external edits (edit a file in Obsidian/git and the app updates).

## Download

Prefer to grab a file by hand? The [Releases](https://github.com/rocketpowerinc/rockion/releases) page has:

- **Windows x64** - `rockion-windows-amd64-installer.exe` or portable `rockion-windows-amd64.exe`
- **macOS Apple Silicon** - `rockion-macos-arm64.zip`
- **AnduinOS x64** - `rockion-anduinos-amd64.deb`

See the [CHANGELOG](./CHANGELOG.md) for what's in each release.

Use the gear menu at the bottom-left of the sidebar for **Check for Updates**,
**Open a New Vault**, and **Theme**. Windows installer and portable builds can
download, verify, and apply the matching update directly.

## Prerequisites

- **Go** 1.26.4
- **Node** 20.19+ or 22.12+
- **Wails CLI v2.12.0**: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`
- Platform deps for Wails development (WebView2 on Windows, WebKitGTK on Linux). Run `wails doctor` to check.

## Develop

```bash
# from the repo root
wails dev
```

`wails dev` generates the Go↔JS bindings into `frontend/wailsjs/`, installs frontend deps,
starts Vite, and opens the desktop window with hot reload.

Opening the Vite URL directly in a browser shows a UI preview only. Native vault
access, filesystem dialogs, updates, and other Go-backed features require the
desktop window created by `wails dev`.

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
then pushes the tag. GitHub Actions builds Windows x64, macOS Apple Silicon,
and an AnduinOS amd64 package with SHA-256 checksums.

After all three platform builds and checksum generation succeed, the resulting
GitHub release is published automatically. See [dev/README.md](./dev/README.md)
for local-only and no-wait options.

The app icon comes from `build/appicon.png`; Wails regenerates platform icon formats
during native builds.

## How it works

1. Launch → "Open a vault folder" → pick any directory of `.md` files.
2. Rockion indexes it in the background (`.rockion/index.db`) and watches for changes.
3. Click a note to edit; type `/` for blocks; `Cmd/Ctrl+P` to jump anywhere.

The SQLite index at `.rockion/index.db` is disposable and rebuilds on the next
open. Back up the rest of `.rockion/`: it contains user settings and metadata
such as icons, covers, Favorites, dashboard views, and page templates.

## How it works under the hood

**Core principle: your `.md` files are the source of truth.** Everything Rockion adds is either
derived (the SQLite index) or stored in a sidecar — the markdown files only ever contain portable
markdown.

**Backend (Go, in `internal/` + `app*.go`)**

- `vault` — opens a folder, reads/writes notes, builds the sidebar tree. On read it splits YAML
  frontmatter from the body and derives a title (frontmatter `title` → first `# H1` → filename).
  Existing frontmatter is preserved byte-for-byte during ordinary saves and dashboard-view
  changes. Rockion only adds managed-page identity fields when it creates a managed project page.
  Path handling rejects root targets, traversal, symlinks, and unsupported note extensions.
  `PlanTitleRename` derives a collision-free filename from a title (used by `RenameToTitle` so
  editing the first `# H1` renames the file and rewrites inbound links).
- `db` — opens `<vault>/.rockion/index.db` using **`modernc.org/sqlite`** (pure Go, no cgo → single
  static binary, easy cross-compile). Pragmas and schema are applied statement-by-statement.
- `indexer` — walks `.md`, `.markdown`, and `.mdx` files, parsing `[[wikilinks]]`, `[md](links)`,
  frontmatter tags, and `#tags` into the DB and feeding an **FTS5** full-text table. Incremental
  mutations are serialized and folder deletes remove the full indexed subtree.
- `search` — FTS5 queries (prefix match on the last term) and backlink lookups. Slice results are
  always returned as `[]T{}` (never nil) so the JSON never serializes to `null`.
- `app*.go` — the Wails binding layer, split by lifecycle, dashboard, media, transfer, and watcher
  responsibilities. Exported methods are callable from JS (`OpenVault`, `ReadNote`, `WriteNote`,
  `Search`, `Backlinks`, `SaveImage`, `SaveFile`, `SetNoteIcon`, …).

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
- **Dashboard views** are stored in `<vault>/.rockion/dashboard-views.json`, so changing layout or
  sort order does not rewrite user frontmatter. Card content and manual order remain portable
  Markdown links in `dashboard.md`.
- **Page templates** are ordinary `.md` files in `<vault>/.rockion/templates/`. Their filenames
  populate the New Page template list each time it opens, so files can be added or removed while
  Rockion is running. Use `{{title}}` (or `{{ title }}`) where the new page title should appear;
  template frontmatter and body content are copied into the new managed page. Rockion records the
  selected template as `rockion_template_tag`, displays it as a colored dashboard tag, and supports
  sorting Gallery or List views by tag. The tag also appears beside the favorite star when a page
  is open. New pages are grouped under their project dashboard in a tag folder: Blank pages go to
  `Other/`, Bootstrap pages to `Bootstraps/`, Cheatsheet pages to `Cheatsheets/`, and custom
  templates to a folder matching their tag. The built-in Prepper, Kids, Health, Education,
  Gaming, Homelab, and Bookmarks templates use matching tag and folder names. Blank and legacy
  pages use the gray `Other` tag. Newly bundled defaults are copied into existing vaults once;
  `.rockion/default-templates.json` remembers them so user-deleted defaults stay deleted.
- **Dashboard covers** load bounded thumbnails on demand; the full validated image is only loaded
  for the active page cover.
- **Page links** are plain markdown links. The icon + ↗ badge are added by a ProseMirror
  *decoration* (`PageLinkDecorations`) that looks up the target's icon from a live registry
  (`pageIcons.ts`) — so nothing is baked into the file and link icons update when a page's icon
  changes. Clicking a link (or its icon) opens that note instead of navigating.
- **Custom image icons** are read in the browser, resized to 64px on a canvas, and stored as a
  `data:` URL in `icons.json` — no backend image handling, and they render anywhere an icon shows.
- **Theme** is a `data-theme` attribute on `<html>` (set before first paint by an inline script in
  `index.html`, persisted to `localStorage`).

The rebuildable index and user metadata both live under `<vault>/.rockion/`.
Only `index.db` is disposable. Vault export includes the metadata sidecars so
icons, covers, Favorites, dashboard settings, and templates survive backup and restore.

## Project layout

```
rockion/
├── main.go                   ← Wails entrypoint
├── app.go                    ← application lifecycle + core note API
├── app_dashboard.go          ← dashboard and managed-page API
├── app_media.go              ← image, cover, icon, and file-save API
├── app_transfer.go           ← encrypted vault import/export API
├── app_watcher.go            ← recursive filesystem watcher + debounce
├── internal/
│   ├── vault/                ← files, managed pages, assets, and sidecar metadata
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
        ├── components/
        │   ├── Dashboard.tsx      ← dashboard state and actions
        │   ├── DashboardCards.tsx ← gallery/list rendering and lazy thumbnails
        │   └── Sidebar, Editor, Backlinks, QuickSwitcher, pickers, etc.
        ├── editor/
        │   ├── extensions.ts ← the full TipTap extension set
        │   ├── Callout.ts    ← callout node + markdown round-trip + color cycle
        │   ├── CodeBlock.ts  ← lowlight code block + language/copy/download toolbar
        │   ├── SlashCommand.ts / SlashMenu.tsx / slashItems.ts
        │   └── AddBlockButton.ts  ← gutter "+" button
```

## Roadmap (not yet built)

Wikilink (`[[ ]]`) autocomplete, a graph view (the link index already tracks everything needed),
drag-to-reorder in the sidebar tree, a tag browser, history/recovery UI, and a permission-scoped
plugin host. See the end of [ARCHITECTURE.md](./ARCHITECTURE.md).
