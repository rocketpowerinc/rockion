# Changelog

All notable changes to Rockion are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-06-12

## [0.1.3] - 2026-06-12

## [0.1.2] - 2026-06-12

### Fixed
- Publish successful release builds immediately instead of leaving them as drafts.
- Generate ignored Wails JavaScript bindings before CI frontend builds.
- Keep the embedded frontend directory valid in pristine checkouts before binding generation.
- Export the Chocolatey NSIS install directory for Windows release packaging.
- Updated pinned GitHub Actions to Node.js 24-compatible releases.
- Consider failed/local release tags when suggesting the next release version.

## [0.1.1] - 2026-06-12

### Security
- Hardened vault paths against root deletion, traversal, symlinks, and unsupported note types.
- Added decoded image validation, payload and dimension limits, and bounded page-icon validation.
- Added SHA-256 compare-before-write conflict protection for external file changes.
- Updated `golang.org/x/sys` to the advisory-fixed `v0.44.0`.
- Hardened CI/release permissions, pinned Actions by commit, and added release checksums.

### Fixed
- Preserve YAML frontmatter byte-for-byte during editing.
- Flush pending autosaves before navigation and surface save failures.
- Reload clean external edits and require an explicit choice for dirty conflicts.
- Use atomic replacement writes for notes, images, and icon metadata.
- Watch nested vault directories with independent per-path debouncing.
- Keep `.md`, `.markdown`, and `.mdx` indexing behavior consistent.
- Remove complete folder subtrees from search and migrate links/icons during renames.
- Index frontmatter and frontmatter tags, check SQL mutation errors, and ignore external URL schemes.

### Added
- Backend regression tests for persistence, path containment, media validation, conflicts,
  indexing, subtree removal, and rename migration.
- Pull-request and main-branch CI with frontend build, dependency audit, race tests, and vetting.

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

[0.1.0]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.0
[0.1.1]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.1
[0.1.2]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.2
[0.1.3]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.3
[0.1.4]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.4
