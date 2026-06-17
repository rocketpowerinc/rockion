# Changelog

All notable changes to Rockion are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Add file-based page version history stored under each vault's `.rockion`
  metadata, with snapshots on edits/deletes, a page-menu restore dialog, and a
  landing-page history overview with a clear-history action.
- Pasting a bare URL now opens a "Paste as" menu (Notion-style): Mention (an inline chip
  showing the site favicon + page title, not a blue link), Bookmark (a preview card with
  title, description, thumbnail, and favicon fetched from the page's Open Graph metadata), or
  URL (the plain link). Mentions are stored portably as `<a data-rockion-mention>`; bookmark
  cards as `<figure data-rockion-bookmark>`, with thumbnails downloaded to `Assets/Bookmarks`.

- Add MP4 video uploads from paste, drag/drop, and the `/Video` slash command.
  Uploaded videos embed as playable local `<video>` blocks with a three-dot
  menu for opening the file location or deleting the asset.

### Changed
- Throttle autosave-created version-history snapshots to one checkpoint per page
  every five minutes while keeping delete/restore/rename snapshots immediate.
- Store uploaded media in typed vault asset folders (`Assets/Images`,
  `Assets/Icons`, `Assets/Covers`, `Assets/Videos`, `Assets/Bookmarks`) with
  page-based timestamped filenames.
- Pin frontend dependency ranges exactly in `package.json` and document `npm ci`
  as the reproducible install path.
- Align pinned frontend dependency versions with the committed lockfile so
  Wails/npm installs resolve without peer-dependency conflicts.
- Make bookmark preview cards more compact (Notion-sized height).
- Deduplicate downloaded bookmark/mention assets by content hash, so the same
  site's favicon or a shared preview image is stored once in `Assets/Bookmarks`
  and reused across links.
- Prefer first-party favicons from the pasted site before falling back to
  Google's favicon service.
- Load spellcheck dictionaries as emitted text assets instead of JavaScript
  chunks, removing Vite's large dictionary chunk warning from release builds.

### Fixed
- Reject link-preview and remote-asset downloads that resolve to localhost or
  private-network addresses, and reject oversized remote images instead of
  saving truncated files.
- Validate downloaded bookmark and favicon bytes before writing them to the
  vault.
- Add direct round-trip coverage for video, bookmark, and mention portable
  markup.
- Refresh architecture and dependency documentation to match the current asset
  model and release workflow.
- Keep uploaded MP4 blocks playable after saving and reopening a page instead
  of degrading them into generic empty HTML blocks.
- Save uploaded page and project icon images into `Assets/Icons` instead of
  embedding them directly in the icon sidecar.
- Save uploaded page and project cover images into `Assets/Covers`, leaving
  `Assets/Images` for inline page-content images.

## [0.1.13] - 2026-06-15

### Added
- Add a collapsible sidebar that persists its compact or expanded state and
  keeps core vault controls available from the compact rail.
- Add AnduinOS package preflight mode to the Windows release coordinator so
  release and Linux package test orchestration live in one script.
- Add clearer release-script guidance when the active Node.js version does not
  match the pinned release toolchain.
- Pin the local and CI frontend toolchain to Node.js 26.3.0 and npm 11.16.0.
- Keep Favorites and Projects available as icon-only navigation when the
  sidebar is collapsed.

### Fixed
- Prevent intermittent project-navigation crashes by replacing Tiptap's
  DOM-reparenting BubbleMenu with a React-owned portal for the selection
  toolbar.
- Allow selected heading text to be linked from the inline toolbar without
  treating linked H1 Markdown as the page filename.
- Keep the first H1 page title plain text only, while still allowing users to
  rename pages by editing the title text.
- Suppress block hover highlighting and block-editing handles on locked pages.

### Changed
- Remove New sub-page from the editor slash-command menu. New managed pages
  continue to be created from their project dashboard.

### Added
- Render external links in an unmistakable theme-aware blue and open them in
  the system browser. Bare domains such as `example.com` are safely normalized
  to HTTPS when added from the selection toolbar.
- Add a text-selection toolbar with bold, italic, underline, strikethrough,
  inline code, and inline link editing. The toolbar stays hidden on locked
  pages.
- Add a Windows development launcher that clears stale Rockion dev processes
  and uses a repository-local Go cache, preventing misleading Vite EPIPE
  failures when Wails exits during startup.
- Add persisted page options beside the favorite star: Lock page prevents
  editing until unlocked, while Full width expands the page header and editor
  across the available content area.
- Rename projects from a hover-only three-dot menu in the sidebar, and relabel
  the sidebar's Folders section as Projects.
- Release active filesystem watches before renaming project directories on
  Windows, then restore watches at the new location.
- Make project names directly editable from dashboard headers. Renaming updates
  the root project folder, dashboard heading, open navigation paths, links, and
  associated icon, cover, favorite, and dashboard-view metadata.
- Position project icons at page-icon scale so they overlap project covers in
  the same way as regular page icons.
- Add a dedicated Remove background action to the block color menu so a
  background tint can be cleared without removing the selected text color.
- Expand the block color picker with gray, blue, indigo, lavender, teal, lime,
  gold, and coral text colors plus matching translucent backgrounds.
- Open block action menus and their nested submenus to the left of the drag
  handle so they no longer cover the block text being edited.
- Add image-cover repositioning to pages and project dashboards. Users can drag
  the cover vertically, save or cancel the framing, and see the saved position
  reflected in dashboard gallery thumbnails.
- Add a sidebar home button that saves pending edits, closes the active vault
  and its background resources, and returns to the vault landing dashboard.
- Replace the minimal vault picker with a responsive welcome dashboard showing
  recently opened and pinned vaults, safe named vault creation, a quick-start
  guide, encrypted backup import, and locally cached vault statistics.
- Compact the welcome dashboard so Vault Safety and Local Overview sit side by
  side with the Pinned Vaults and Quick-start cards on wider windows.
- Add a GitHub repository link to the welcome dashboard header.
- Arrange Local Overview statistics in a compact two-by-two grid so values and
  labels remain readable inside the smaller welcome card.
- Increase the default desktop window to 1320 by 900 pixels and tighten welcome
  page spacing so the complete dashboard is visible without initial scrolling.
- Add theme-aware scrollbars with dark gray tracks and thumbs in dark mode.
- Add vault-local page templates in `.rockion/templates/`. Template filenames
  populate the New Page menu dynamically, custom YAML/body content is copied
  into new pages, and `{{title}}` placeholders receive the entered page title.
- Tag newly created pages with their source template, show color-coded tags on
  Gallery cards and in a List-view column, and allow dashboards to sort by tag.
  Blank and legacy pages use a gray Other tag; Bootstrap and Cheatsheet variants
  use neon green and neon pink, with stable neon colors for custom templates.
- Show the active page's template tag immediately left of the favorite star and
  store newly created pages in project-local tag folders: `Other`, `Bootstraps`,
  `Cheatsheets`, or a folder matching a custom template tag.
- Add stable Prepper, Kids, Health, and Education template tags with matching
  project folder names and dedicated neon colors.
- Add the Gaming template with a cyan tag and matching folder, change Prepper
  to neon orange, and change Education to neon red.
- Add Homelab and Bookmarks template mappings with matching folders and stable
  neon blue and neon lime tags.
- Sync newly bundled default templates into existing vaults once while tracking
  seen defaults in `.rockion/default-templates.json`, so later user deletions
  remain respected.
- Add a Notion-style block menu, opened by clicking the drag grip (⋮⋮) beside a block:
  Turn into (paragraph, headings, bulleted/numbered/to-do lists, quote, code, callout),
  Color (cyberpunk text and background palette), Duplicate, and Delete. Colored runs are
  stored as portable inline `<span style>` markup, so HTML round-tripping is now enabled in
  the Markdown serializer. (Copy-link-to-block and Move-to are coming in a follow-up.)

- Project dashboards (`dashboard.md`) open as Gallery and List views over their managed
  pages. Each card shows the page icon, title, cover, and the created/last-modified dates;
  drag to reorder, sort by title/created/modified, pick a template (Blank / Task / Meeting
  note) for new pages, and use arrow keys to move between cards. The dashboard markdown
  stays a plain link list (still readable in Obsidian).
- Project dashboards support full covers directly in the card view (full-bleed banner with
  change/remove controls).
- Projects can now have an emoji or uploaded image icon — it's the dashboard page's icon,
  changeable by clicking the icon on the dashboard landing page or the folder icon in the
  sidebar, and the two stay in sync.
- Breadcrumbs reset when you move into a different project, so the current project's
  dashboard is always the root of the trail.
- Dashboard image covers now use bounded thumbnails that load only when their
  cards approach the viewport.
- Expand the page icon gallery to more than 100 categorized emoji choices and
  add keyword search with aliases such as house, home, code, work, and money.
- Show each target page's live icon beside internal dashboard links, including
  managed links with Rockion query metadata, and add an icon-aware breadcrumb
  history above the page for navigating back through recently opened pages.
- Add Notion-style page covers with a built-in solid-color and gradient
  gallery, validated local image uploads, hover controls to change or remove a
  cover, and vault-portable metadata that follows page and folder renames.
- Give project sub-pages stable UUIDs in Markdown frontmatter and manage their
  dashboard links so automatic labels and targets follow page title or filename
  changes while custom link aliases remain intact.
- Add a dashboard link context action that deletes a managed project page and
  its entry together. Direct deletion of project pages is blocked to prevent
  orphaned dashboard state.

### Changed
- Keep the block color palette open after applying colors, add white as the
  first text swatch, and preserve marked text colors while text is selected.
- Pin the release toolchain to Node.js 24.16.0 LTS, npm 11.17.0, Go
  toolchain 1.26.4, Wails 2.12.0, and NSIS 3.12.0. CI now runs the pinned npm
  version and audits both npm and Go dependencies.
- Add weekly Dependabot update groups for frontend packages, Go modules, and
  GitHub Actions while retaining lockfile- and commit-SHA-based builds.
- Move dashboard page-template selection into the New page dialog, directly
  below the page-title field, for both New page entry points.
- Replace hard-coded Blank, Task, and Meeting Note template logic with seeded
  Markdown files that users can add or remove without restarting Rockion.
- Split the main Wails, vault filesystem/media, and dashboard UI modules into
  focused files before further dashboard expansion.
- Store dashboard layout and sorting preferences in
  `.rockion/dashboard-views.json` instead of rewriting dashboard frontmatter.

### Removed
- Remove the Unsplash cover option and remote-cover rendering. Covers now use
  built-in colors, gradients, or validated images uploaded into the vault.
- Drop the page "Date" property — it had no behavior and went unused.

### Fixed
- Render gallery image covers with `object-position` using the page's saved
  vertical framing, so cards match the repositioned cover shown on the page.
- Round dragged cover positions to whole percentages before sending them through
  Wails, preventing fractional values from failing Go integer decoding.
- Make slash-command search punctuation-insensitive and add common To-do
  aliases, so `todo`, `to do`, `task`, `checkbox`, and `checklist` find To-do.
- Align to-do checkboxes with their first text line and strike through only the
  checked item’s own content, leaving nested child tasks independently styled.
- Make every Block menu “Turn into” conversion structural and reliable,
  including bullet/numbered lists to to-do lists, lists to headings, and task
  lists back to ordinary text or list blocks without losing item content.
- Allow the Vite page at `localhost:5173` to render as an explicit browser
  preview without a Wails bridge; native vault actions stay disabled until the
  frontend runs inside the desktop window.
- Restore managed-page deletion from dashboard cards, removing the Markdown
  file and authoritative dashboard entry together.
- Refresh an open dashboard after external vault changes and restrict drag
  reordering to manual-order views so sorted displays cannot corrupt link order.
- Preserve existing dashboard frontmatter byte-for-byte when changing layout
  or sort settings.
- Raise the cover action controls above the overlapping page header so both
  Change cover and Remove remain clickable.
- Remove the corner arrow badge from authoritative managed dashboard entries
  while retaining it on ordinary embedded page links created with Link to page.
- Keep cover change/remove controls softly visible and enlarge their hover
  target so they no longer disappear while the pointer moves toward them.
- Repair duplicate managed-page IDs automatically when a page file is copied,
  ensuring both pages keep independent dashboard entries.

## [0.1.12] - 2026-06-13

### Added
- Add password-protected vault export and import from the Settings menu. Exports
  are timestamped `.rockion` archives encrypted with scrypt and chunked
  AES-256-GCM; imports verify integrity, restore into a new folder, and open the
  restored vault automatically.
- Add a dashboard-based sidebar: every visible root folder receives a
  `dashboard.md` entry page, Favorites support starring and drag reordering,
  loose root notes remain available under Unsorted, and `/New sub-page` creates
  a linked Markdown page beside the current page.
- Change the sidebar `+` button and `Ctrl/Cmd+N` to create a root project with
  an integrated `dashboard.md`. New pages can now only be created inside a
  project through `/New sub-page`.

## [0.1.11] - 2026-06-13

- Fixed Enter being swallowed after slash-prefixed text when no slash command matches.
- Added a persistent English/French writing-language setting backed by bundled
  offline dictionaries, with English as the default. Existing text is reparsed
  immediately, and right-clicking an underlined word shows language-correct
  replacement choices.
- Restored automatic linking for recognized web addresses and domains while
  keeping `.md` filenames as plain text. Web links are light blue and include a
  right-click action to remove the link without deleting its text.
- Remove any stale partial link mark from the complete `.md` filename when an
  existing linked domain is edited into a Markdown path.
### Fixed
- Install the Windows app into a single `C:\Program Files\Rockion\` folder (was the doubled
  `C:\Program Files\Rockion\Rockion\`) and name the installed executable `Rockion.exe`.
  The installer now removes the legacy nested installation before upgrading.
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
- **Blocks** — tables, checklists, and image paste/drop.
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
[0.1.11]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.11
[0.1.12]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.12
[0.1.13]: https://github.com/rocketpowerinc/rockion/releases/tag/v0.1.13
