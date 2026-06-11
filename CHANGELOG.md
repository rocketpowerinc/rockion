# Changelog

All notable changes to Rockion are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-10

First release. A working local-first markdown editor: Notion-style UI over plain
`.md` files on disk, in a single Wails binary.

### Added
- **Vaults** — open any folder of markdown files; the file tree loads in the sidebar.
- **Editor** — TipTap editor that reads and writes GitHub-Flavored Markdown directly to disk, with debounced autosave (no save button).
- **Slash menu** — type `/` for headings, lists, to-dos, tables, quotes, code blocks, and dividers.
- **Blocks** — tables, checklists, and image paste/drop (images saved into `assets/`).
- **Search** — full-text search (SQLite FTS5) and a `Cmd/Ctrl+P` quick switcher.
- **Backlinks** — linked-references panel powered by a link index.
- **Live re-index** — external edits (Obsidian, git pull) are picked up via a file watcher.
- **Resilience** — background indexing and the file watcher recover from panics; the UI has an error boundary so failures show a readable message instead of a blank screen.

### Known limitations
- The file watcher only watches the vault root, not nested subfolders.
- No wikilink autocomplete, graph view, or drag-to-reorder yet (see the roadmap in README).
- Large bundle size warning at build time (TipTap); cosmetic only.

[0.1.0]: https://github.com/rocket/rockion/releases/tag/v0.1.0
