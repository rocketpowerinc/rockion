# Changelog

All notable changes to Rockion are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

- Fixed Enter being swallowed after slash-prefixed text when no slash command matches.
- Added a persistent English/French writing-language setting backed by bundled
  offline dictionaries, with English as the default. Existing text is reparsed
  immediately, and right-clicking an underlined word shows language-correct
  replacement choices.
### Fixed
- Install the Windows app into a single `C:\Program Files\Rockion\` folder (was the doubled
  `C:\Program Files\Rockion\Rockion\`) and name the installed executable `Rockion.exe`.
- Name the macOS bundle `Rockion.app` (was lowercase `rockion.app`) so the Dock, Launchpad,
  and Finder all show "Rockion" with a capital R.

### Added
- One-command uninstallers for AnduinOS, Windows, and macOS in the README, with matching
  maintained scripts (`dev/linux/uninstall.sh`, `dev/windows/uninstall.ps1`, `dev/macos/uninstall.sh`).

### Added
- Editing a note's title (its first `# Heading`) now renames the file on disk to match,
  shortly after you stop typing. Name clashes get a numeric suffix (`Ideas 2.md`), inbound
  links are rewritten, and the cursor is preserved during the rename.

### Changed
- Redraw the sidebar settings icon as a solid, blocky 8-tooth gear (was a thin rounded outline).

### Fixed
- Stop auto-linking plain text like `notes.md`. `.md` is a real TLD, so the editor's
  autolinker treated any `word.md` as a web address; autolink is now disabled (use
  `/Link to page` or `[text](url)` to make links).
- Creating a new page now works on macOS. The "+" button used the native `window.prompt`,
  which returns `null` under Wails' macOS WebView, so it silently did nothing; replaced it
  with an in-app new-page dialog that works on all platforms.
- Serialize vault mutations and use conflict-checked link rewrites so title renames cannot
  overwrite simultaneous saves or external edits.
- Update only renamed and rewritten notes in the search index instead of rebuilding the
  entire vault after each title change.
- Prevent duplicate page submissions, create notes exclusively, and handle case-only title
  renames without adding an unnecessary numeric suffix.
- Disable fuzzy Markdown linkification so plain filenames such as `notes.md` remain text.
- Block remote images in notes and add a restrictive content security policy so opening a
  vault cannot make hidden image requests.
- Verify SHA-256 checksums before maintained install scripts execute release artifacts, add
  optional Windows/macOS signing hooks, and expand release-time secret detection.

## [0.1.10] - 2026-06-13

### Fixed
- Ship the Linux app icon at standard hicolor sizes (64–512px) plus a `/usr/share/pixmaps`
  fallback, and refresh the icon/desktop caches on install, so Rockion shows its icon in the
  AnduinOS app drawer (the previous 1024×1024-only icon was never indexed by the icon theme).

## [0.1.9] - 2026-06-12

### Fixed
- Replace the Debian 12 package with an AnduinOS amd64 package linked against WebKitGTK 4.1.
- Build the Linux package once per release; keep the standalone AnduinOS preflight optional.
- Reject Linux artifacts that contain any direct WebKitGTK 4.0 dependency before publication.

## [0.1.8] - 2026-06-12

### Fixed
- Replace Linux AppImage packaging with a native amd64 `.deb` built and tested on Debian 12.
- Validate Debian package installation and startup before creating release tags.
- Limit releases to Windows x64, macOS Apple Silicon, and Debian 12 amd64.

## [0.1.7] - 2026-06-12

### Fixed
- Install Fontconfig and GLES interfaces in Linux AppImage compatibility smoke environments.

## [0.1.6] - 2026-06-12

## [0.1.5] - 2026-06-12

### Added
- Added a cross-platform sidebar settings menu for updates, vault selection, and theme switching.
- Added secure update checks and verified Windows installer/portable updates.

### Fixed
- Replace raw Linux archives with self-contained x86_64 and ARM64 AppImages tested across Ubuntu, Debian, and Fedora.
- Install host EGL/OpenGL interfaces during AppImage smoke tests and execute container test scripts interactively.
- Make Windows release remote-tag checks resilient to missing tags and transient GitHub connection failures.

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
[0.1.5]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.5
[0.1.6]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.6
[0.1.7]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.7
[0.1.8]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.8
[0.1.9]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.9
[0.1.10]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.10
