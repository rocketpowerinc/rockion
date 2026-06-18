import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { isSafeImageSource } from "../src/editor/imageSources.mjs";
import { shouldHandleSlashMenuKey } from "../src/editor/slashMenuKeys.mjs";
import {
  matchesSlashSearch,
  normalizeSlashSearch,
} from "../src/editor/slashSearch.mjs";
import nspell from "nspell";
import englishDictionary from "dictionary-en";
import frenchDictionary from "dictionary-fr";
import {
  isMarkdownAutoLink,
  markdownFilenameRanges,
  shouldAutoLink,
} from "../src/editor/linkPolicy.mjs";
import {
  managedPageHref,
  managedPageIDFromHref,
  isInternalNoteHref,
  pageDirectory,
  relativePageHref,
  resolvePageHref,
} from "../src/editor/pagePaths.mjs";
import {
  coverBackground,
  coverGradients,
} from "../src/editor/coverStyles.mjs";
import {
  isExternalHref,
  normalizeExternalHref,
} from "../src/editor/externalLinks.mjs";
import {
  emojiCatalog,
  searchEmojis,
} from "../src/editor/emojiCatalog.mjs";
import {
  imageIconURL,
  isImageIcon,
} from "../src/editor/imageIcons.mjs";
import {
  parseVideoBlock,
  renderVideoAssetHTML,
  serializeVideoAsset,
} from "../src/editor/videoMarkup.mjs";
import {
  parseBookmarkElement,
  parseMentionElement,
  serializeBookmark,
  serializeMention,
} from "../src/editor/linkPreviewMarkup.mjs";

test("plain markdown filenames are not fuzzy-linked", () => {
  const source = fs.readFileSync(new URL("../src/editor/extensions.ts", import.meta.url), "utf8");
  assert.match(source, /Markdown\.configure\(\{[\s\S]*linkify:\s*false/);

  const parser = new MarkdownIt({ html: false, linkify: false });
  assert.equal(parser.render("notes.md"), "<p>notes.md</p>\n");
  for (const value of [
    "notes.md",
    "folder/notes.md",
    "https://example.com/notes.md",
    "https://example.md",
  ]) {
    assert.equal(isMarkdownAutoLink(value), true, value);
    assert.equal(shouldAutoLink(value), false, value);
  }
  for (const value of ["example.com", "https://example.org", "hello.net/path"]) {
    assert.equal(shouldAutoLink(value), true, value);
  }

  assert.deepEqual(markdownFilenameRanges("before hello.md after"), [
    { from: 7, to: 15 },
  ]);
  assert.deepEqual(markdownFilenameRanges("folder/my.file.md"), [
    { from: 0, to: 17 },
  ]);
});

test("links have a removable context menu", () => {
  const source = fs.readFileSync(
    new URL("../src/editor/LinkContextMenu.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /Remove link/);
  assert.match(source, /Delete linked page/);
  assert.match(source, /rockion:delete-managed-page/);
  assert.match(source, /removeMark\(range\.from,\s*range\.to,\s*linkType\)/);
  assert.match(source, /setMeta\("preventAutolink",\s*true\)/);
});

test("selected text exposes inline formatting and link controls", () => {
  const toolbar = fs.readFileSync(
    new URL("../src/components/SelectionToolbar.tsx", import.meta.url),
    "utf8"
  );
  const extensions = fs.readFileSync(
    new URL("../src/editor/extensions.ts", import.meta.url),
    "utf8"
  );
  const pageTitlePlainText = fs.readFileSync(
    new URL("../src/editor/PageTitlePlainText.ts", import.meta.url),
    "utf8"
  );
  const underline = fs.readFileSync(
    new URL("../src/editor/Underline.ts", import.meta.url),
    "utf8"
  );
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );

  for (const command of [
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleStrike",
    "toggleCode",
    "setLink",
  ]) {
    assert.match(toolbar, new RegExp(command));
  }
  assert.match(toolbar, /const \{ from, to, empty \} = editor\.state\.selection/);
  assert.match(toolbar, /locked \|\|[\s\S]*!editor\.isEditable \|\|[\s\S]*empty/);
  assert.match(toolbar, /selectionTouchesPageTitle\(editor\.state\)/);
  assert.match(toolbar, /className="selection-link-form"/);
  assert.match(toolbar, /if \(editor\.isActive\("link"\)\) command = command\.extendMarkRange\("link"\)/);
  assert.match(toolbar, /command\.setLink\(\{ href: value \}\)\.run\(\)/);
  assert.match(toolbar, /createPortal/);
  assert.doesNotMatch(toolbar, /\bBubbleMenu\b/);
  assert.match(editor, /<SelectionToolbar editor=\{editor\} locked=\{pageSettings\.locked\}/);
  assert.ok(editor.includes("function plainHeadingTitle(value: string): string"));
  assert.ok(editor.includes('return m ? plainHeadingTitle(m[1]) : "";'));
  assert.match(extensions, /\bUnderline\b/);
  assert.match(extensions, /\bPageTitlePlainText\b/);
  assert.match(pageTitlePlainText, /name: "pageTitlePlainText"/);
  assert.match(pageTitlePlainText, /titleHeadingRange/);
  assert.match(pageTitlePlainText, /selectionTouchesPageTitle/);
  assert.match(pageTitlePlainText, /newState\.tr\.removeMark\(range\.from,\s*range\.to\)/);
  assert.match(underline, /tag:\s*"u"/);
  assert.match(underline, /return \["u",\s*mergeAttributes\(HTMLAttributes\),\s*0\]/);
});

test("pages support browser-style in-page find without mutating markdown", () => {
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const extensions = fs.readFileSync(
    new URL("../src/editor/extensions.ts", import.meta.url),
    "utf8"
  );
  const pageFind = fs.readFileSync(
    new URL("../src/editor/PageFind.ts", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(extensions, /PageFind/);
  assert.match(editor, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(editor, /createPortal/);
  assert.match(editor, /document\.body/);
  assert.match(editor, /setFindOpen\(true\)/);
  assert.match(editor, /role="search"/);
  assert.match(editor, /onStep\(event\.shiftKey \? -1 : 1\)/);
  assert.match(pageFind, /Decoration\.inline/);
  assert.match(pageFind, /searchableAtomText/);
  assert.match(pageFind, /attrs\.description/);
  assert.match(pageFind, /attrs\.siteName/);
  assert.match(pageFind, /Decoration\.node/);
  assert.match(pageFind, /NodeSelection\.create/);
  assert.match(pageFind, /class:\s*[\s\S]*page-find-match is-active/);
  assert.doesNotMatch(pageFind, /setContent|insertContent|deleteRange/);
  assert.match(styles, /\.page-find-bar/);
  assert.match(styles, /\.page-find-bar\s*\{[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.page-find-match\.is-active/);
  assert.match(styles, /\.bookmark-card\.page-find-match/);
});

test("dragged blocks can indent or outdent by horizontal drop position", () => {
  const extensions = fs.readFileSync(
    new URL("../src/editor/extensions.ts", import.meta.url),
    "utf8"
  );
  const dragIndent = fs.readFileSync(
    new URL("../src/editor/DragIndent.ts", import.meta.url),
    "utf8"
  );
  const indentBlock = fs.readFileSync(
    new URL("../src/editor/IndentBlock.ts", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(extensions, /DragIndent/);
  assert.match(extensions, /IndentBlock/);
  assert.match(extensions, /"indentBlock"/);
  assert.match(dragIndent, /sinkListItem/);
  assert.match(dragIndent, /liftListItem/);
  assert.match(dragIndent, /wrapIn\("indentBlock"\)/);
  assert.match(dragIndent, /lift\("indentBlock"\)/);
  assert.match(dragIndent, /CONTAINER_BLOCK_SELECTOR/);
  assert.match(dragIndent, /event\.clientY < rect\.top \+ rect\.height \/ 2/);
  assert.match(dragIndent, /dataset\.dragIndent/);
  assert.match(dragIndent, /drag-indent-guide/);
  assert.match(indentBlock, /\[!INDENT\]/);
  assert.match(indentBlock, /data-rockion-indent/);
  assert.match(styles, /\.drag-indent-guide/);
  assert.match(styles, /\.drag-indent-guide\.is-outdent/);
  assert.match(styles, /translateY\(-50%\)/);
});

test("external links are normalized, styled blue, and opened outside Rockion", () => {
  assert.equal(normalizeExternalHref("example.com"), "https://example.com");
  assert.equal(normalizeExternalHref("www.example.com/path"), "https://www.example.com/path");
  assert.equal(normalizeExternalHref("https://example.com"), "https://example.com");
  assert.equal(normalizeExternalHref("mailto:user@example.com"), "mailto:user@example.com");
  assert.equal(normalizeExternalHref("javascript:alert(1)"), "");
  assert.equal(isExternalHref("https://example.com"), true);
  assert.equal(isExternalHref("../Page.md"), false);

  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const toolbar = fs.readFileSync(
    new URL("../src/components/SelectionToolbar.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(toolbar, /normalizeExternalHref\(href\)/);
  assert.match(editor, /isExternalHref\(href\)[\s\S]*api\.openExternal\(href\)/);
  assert.match(styles, /\.rk-prose a:not\(\.page-link\)[\s\S]*#2587e8 !important/);
});

test("only local and explicitly embedded image sources are allowed", () => {
  for (const source of [
    "Assets/Images/image.png",
    "../shared/image.png",
    "/Rockion-Hero.png",
    "blob:local-preview",
    "data:image/png;base64,iVBORw0KGgo=",
  ]) {
    assert.equal(isSafeImageSource(source), true, source);
  }
  for (const source of [
    "https://example.com/tracker.png",
    "http://example.com/tracker.png",
    "//example.com/tracker.png",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html;base64,PGgxPkJhZDwvaDE+",
  ]) {
    assert.equal(isSafeImageSource(source), false, source);
  }
});

test("MP4 uploads render as local video assets with asset actions", () => {
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const videoAsset = fs.readFileSync(
    new URL("../src/editor/VideoAsset.ts", import.meta.url),
    "utf8"
  );
  const videoMarkup = fs.readFileSync(
    new URL("../src/editor/videoMarkup.mjs", import.meta.url),
    "utf8"
  );
  const emojiPicker = fs.readFileSync(
    new URL("../src/components/EmojiPicker.tsx", import.meta.url),
    "utf8"
  );
  const slashItems = fs.readFileSync(
    new URL("../src/editor/slashItems.ts", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.match(api, /saveVideo/);
  assert.match(api, /openAssetInFolder/);
  assert.match(api, /deleteAsset/);
  assert.match(editor, /accept="video\/mp4,\.mp4"/);
  assert.match(editor, /api\.saveVideo\(`\$\{currentPageAssetName\(\)\}\.mp4`/);
  assert.match(editor, /setVideo\(\{ src: relPath/);
  assert.match(editor, /rockion:upload-video/);
  assert.match(editor, /rockion:video-asset-action/);
  assert.match(videoAsset, /name: "videoAsset"/);
  assert.match(videoMarkup, /\^Assets\\\/Videos\\\/\[\^\?#<>"\]\+\\\.mp4\$/);
  assert.match(videoAsset, /addStorage\(\)/);
  assert.match(videoAsset, /serialize\(state: any, node: any\)/);
  assert.match(videoAsset, /markdownit\.use\(videoMarkdownItPlugin\)/);
  assert.match(videoAsset, /assetURL\(src\)/);
  assert.match(videoAsset, /storedVideoSource/);
  assert.match(videoAsset, /serializeVideoAsset\(\{ src, title \}, caption\)/);
  assert.match(videoAsset, /renderVideoAssetHTML\(tokens\[idx\]\.content\)/);
  assert.match(videoAsset, /Open in folder/);
  assert.match(videoAsset, /Delete asset/);
  assert.match(emojiPicker, /api\.saveIconImage\(assetName,\s*Array\.from\(data\)\)/);
  assert.doesNotMatch(emojiPicker, /toDataURL/);
  assert.match(slashItems, /title:\s*"Video"/);
  assert.match(styles, /\.video-asset/);
  assert.match(styles, /\.video-asset-menu/);
  assert.match(index, /media-src 'self'/);
});

test("video, bookmark, and mention markup round-trip through portable HTML", () => {
  const video = serializeVideoAsset(
    { src: "/Assets/Videos/my-page-2026-06-15-205140.mp4", title: 'Demo "Clip"' },
    "caption <safe>"
  );
  assert.match(video, /^<figure data-rockion-video>/);
  assert.match(video, /<video src="Assets\/Videos\/my-page-2026-06-15-205140\.mp4" controls preload="metadata" title="Demo &quot;Clip&quot;"><\/video>/);
  const parsedVideo = parseVideoBlock(video);
  assert.deepEqual(parsedVideo, {
    src: "Assets/Videos/my-page-2026-06-15-205140.mp4",
    title: 'Demo "Clip"',
    caption: "caption <safe>",
  });
  assert.equal(
    renderVideoAssetHTML(video),
    '<figure data-rockion-video><video src="/Assets/Videos/my-page-2026-06-15-205140.mp4" controls preload="metadata" title="Demo &quot;Clip&quot;"></video><figcaption>caption &lt;safe&gt;</figcaption></figure>\n'
  );
  assert.equal(parseVideoBlock('<video src="https://example.com/tracker.mp4"></video>'), null);

  const bookmark = serializeBookmark({
    url: "https://example.com/path",
    title: "Example <Site>",
    description: "Description & more",
    image: "/Assets/Bookmarks/hash.webp",
    favicon: "Assets/Bookmarks/example.com.ico",
    siteName: "Example",
  });
  const renderedBookmark = new MarkdownIt({ html: true, linkify: false }).render(bookmark);
  assert.match(renderedBookmark, /<figure data-rockion-bookmark/);
  const fakeFigure = {
    getAttribute: (name) =>
      name === "data-favicon"
        ? "Assets/Bookmarks/example.com.ico"
        : name === "data-site"
          ? "Example"
          : "",
    querySelector: (selector) => {
      const nodes = {
        a: { getAttribute: () => "https://example.com/path", textContent: "Example <Site>" },
        p: { textContent: "Description & more" },
        img: { getAttribute: () => "/Assets/Bookmarks/hash.webp" },
      };
      return nodes[selector] || null;
    },
  };
  assert.deepEqual(parseBookmarkElement(fakeFigure), {
    url: "https://example.com/path",
    title: "Example <Site>",
    description: "Description & more",
    image: "Assets/Bookmarks/hash.webp",
    favicon: "Assets/Bookmarks/example.com.ico",
    siteName: "Example",
  });

  const mention = serializeMention({
    url: "https://example.com",
    title: "Example",
    favicon: "Assets/Bookmarks/example.com.ico",
  });
  assert.equal(
    mention,
    '<a href="https://example.com" data-rockion-mention data-favicon="Assets/Bookmarks/example.com.ico">Example</a>'
  );
  const fakeAnchor = {
    getAttribute: (name) =>
      name === "href"
        ? "https://example.com"
        : name === "data-favicon"
          ? "Assets/Bookmarks/example.com.ico"
          : "",
    textContent: "Example",
  };
  assert.deepEqual(parseMentionElement(fakeAnchor), {
    url: "https://example.com",
    title: "Example",
    favicon: "Assets/Bookmarks/example.com.ico",
  });
});

test("uploaded image icons are stored as vault icon assets", () => {
  const imageIcons = fs.readFileSync(
    new URL("../src/editor/imageIcons.mjs", import.meta.url),
    "utf8"
  );
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );
  const decorations = fs.readFileSync(
    new URL("../src/editor/PageLinkDecorations.ts", import.meta.url),
    "utf8"
  );

  assert.equal(isImageIcon("Assets/Icons/note-icon.png"), true);
  assert.equal(imageIconURL("Assets/Icons/note-icon.png"), "/Assets/Icons/note-icon.png");
  assert.equal(isImageIcon("Assets/Images/legacy-note-icon.png"), true);
  assert.equal(isImageIcon("Assets/Videos/bad.mp4"), false);
  assert.match(imageIcons, /return `\/\$\{value\}`/);
  assert.match(editor, /api\.saveImage\(currentPageAssetName\(\),\s*Array\.from\(buf\)\)/);
  assert.match(editor, /api\.saveCoverImage\(currentPageAssetName\(\),\s*Array\.from\(data\)\)/);
  assert.match(imageIcons, /Images\|Icons\|Covers\|Videos\|Bookmarks/);
  assert.match(editor, /assetName=\{currentPageAssetName\(\)\}/);
  assert.match(dashboard, /assetName=\{note\.title \|\| "project-icon"\}/);
  assert.match(sidebar, /assetName=\{node\.name \|\| "project-icon"\}/);
  for (const source of [editor, dashboard, sidebar, decorations]) {
    assert.match(source, /isImageIcon/);
    assert.match(source, /imageIconURL/);
  }
});

test("an unmatched slash command does not block Enter", () => {
  assert.equal(shouldHandleSlashMenuKey("Enter", 0), false);
  assert.equal(shouldHandleSlashMenuKey("ArrowDown", 0), false);
  assert.equal(shouldHandleSlashMenuKey("Enter", 1), true);
});

test("to-do slash commands match common spellings and aliases", () => {
  const item = {
    title: "To-do",
    hint: "Checklist item",
    aliases: ["todo", "to do", "task", "checkbox", "checklist"],
  };
  assert.equal(normalizeSlashSearch("To-do"), "todo");
  for (const query of ["todo", "to do", "to-do", "task", "checkbox", "checklist"]) {
    assert.equal(matchesSlashSearch(item, query), true, query);
  }
  assert.equal(matchesSlashSearch(item, "quote"), false);
});

test("the editor enables offline English and French spellcheck", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );

  assert.match(app, /rockion-writing-language/);
  assert.match(app, /"en-US"\s*\?\s*"fr-FR"\s*:\s*"en-US"/);
  assert.match(editor, /spellcheck:\s*"false"/);
  assert.match(editor, /lang:\s*writingLanguage/);
  assert.match(editor, /refreshSpellcheck\(editor,\s*writingLanguage\)/);
  assert.match(sidebar, />Writing Language</);
});

test("offline dictionaries switch between English and French", () => {
  const english = nspell(englishDictionary);
  const french = nspell(frenchDictionary);

  assert.equal(english.correct("house"), true);
  assert.equal(english.correct("maison"), false);
  assert.equal(french.correct("maison"), true);
  assert.ok(french.suggest("maizon").includes("maison"));
});

test("sub-pages use portable relative markdown links", () => {
  assert.equal(pageDirectory("Projects/dashboard.md"), "Projects");
  assert.equal(
    relativePageHref("Projects/dashboard.md", "Projects/New Page.md"),
    "New Page.md"
  );
  assert.equal(
    resolvePageHref("Projects/dashboard.md", "New%20Page.md"),
    "Projects/New Page.md"
  );
  assert.equal(
    relativePageHref("Projects/dashboard.md", "Reference/Other.md"),
    "../Reference/Other.md"
  );
  const managed = managedPageHref(
    "Projects/dashboard.md",
    "Projects/New Page.md",
    "page-id",
    "New Page"
  );
  assert.match(managed, /^New Page\.md\?/);
  assert.equal(managedPageIDFromHref(managed), "page-id");
  assert.equal(isInternalNoteHref(managed), true);
  assert.equal(isInternalNoteHref("New Page.md#section"), true);
});

test("the slash menu excludes sub-page creation", () => {
  const source = fs.readFileSync(
    new URL("../src/editor/slashItems.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /title:\s*"New sub-page"/);
  assert.doesNotMatch(source, /rockion:new-sub-page/);
});

test("the sidebar plus button creates projects rather than root notes", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );
  assert.match(sidebar, /title="New project"/);
  assert.match(sidebar, /onClick=\{onNewProject\}/);
  assert.match(app, /api\.createProject\(trimmed\)/);
  assert.doesNotMatch(app, /setNewPageDir/);
});

test("the sidebar exposes vault search next to new project", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const search = fs.readFileSync(
    new URL("../src/components/VaultSearch.tsx", import.meta.url),
    "utf8"
  );
  assert.match(sidebar, /title="New project"[\s\S]*title="Search vault"/);
  assert.match(sidebar, /onClick=\{onSearchVault\}/);
  assert.match(app, /<VaultSearch/);
  assert.match(api, /searchVault:\s*\(query: string\)/);
  assert.match(search, /titleMatches/);
  assert.match(search, /contentMatches/);
  assert.match(search, /Page titles/);
  assert.match(search, /Page content/);
});

test("the sidebar can collapse into a compact control rail", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(app, /rockion-sidebar-collapsed/);
  assert.match(app, /sidebarCollapsed \? "sidebar-collapsed" : ""/);
  assert.match(sidebar, /collapsed: boolean/);
  assert.match(sidebar, /onToggleCollapsed/);
  assert.match(sidebar, /Expand sidebar/);
  assert.match(sidebar, /Collapse sidebar/);
  assert.match(sidebar, /<SidebarSection title="Favorites" collapsed=\{collapsed\}>/);
  assert.match(sidebar, /<SidebarSection title="Projects" collapsed=\{collapsed\}>/);
  assert.match(styles, /\.app\.sidebar-collapsed/);
  assert.match(styles, /\.sidebar\.is-collapsed \.sidebar-row-button/);
  assert.match(styles, /\.sidebar\.is-collapsed \.sidebar-section\.is-compact \.sidebar-section-title\[title="Favorites"\]::before/);
  const collapsedTreeBlock = styles.match(/\.sidebar\.is-collapsed \.tree\s*\{[^}]*\}/)?.[0] || "";
  assert.doesNotMatch(collapsedTreeBlock, /display:\s*none/);
});

test("page covers allow generated and validated image backgrounds", () => {
  assert.equal(
    coverBackground({ kind: "color", value: "#336699" }),
    "#336699"
  );
  assert.equal(
    coverBackground({ kind: "gradient", value: "aurora" }),
    coverGradients.aurora
  );
  assert.match(
    coverBackground(
      { kind: "image" },
      "data:image/png;base64,iVBORw0KGgo="
    ),
    /^url\("data:image\/png;base64,/
  );
  assert.equal(coverBackground({ kind: "remote", value: "https://example.com" }), "");

  const picker = fs.readFileSync(
    new URL("../src/components/CoverPicker.tsx", import.meta.url),
    "utf8"
  );
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  assert.match(dashboard, /api\.saveCoverImage\(file\.name,\s*Array\.from\(data\)\)/);
  assert.match(picker, /Choose an image/);
  assert.doesNotMatch(picker, /Browse Unsplash/);
  assert.match(picker, /Remove cover/);
});

test("page navigation renders icon-aware clickable breadcrumbs", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const breadcrumbs = fs.readFileSync(
    new URL("../src/components/Breadcrumbs.tsx", import.meta.url),
    "utf8"
  );
  const decorations = fs.readFileSync(
    new URL("../src/editor/PageLinkDecorations.ts", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(app, /navigationHistory/);
  assert.match(app, /<Breadcrumbs/);
  assert.match(app, /openNote\(path,\s*index\)/);
  assert.match(breadcrumbs, /aria-label="Page history"/);
  assert.match(breadcrumbs, /breadcrumb-icon-img/);
  assert.match(breadcrumbs, /onOpen\(index,\s*item\.path\)/);
  assert.match(decorations, /rockion:page-icons-changed/);
  assert.match(decorations, /managed-page-link-icon/);
  assert.match(decorations, /embedded-page-link-icon/);
  assert.match(styles, /\.embedded-page-link-icon::after/);
  assert.doesNotMatch(styles, /\.page-link-icon::after/);
});

test("the icon picker has a searchable expanded emoji catalog", () => {
  assert.ok(emojiCatalog.length > 100);
  assert.deepEqual(
    searchEmojis("house").map(([emoji]) => emoji),
    ["🏠", "🏡"]
  );
  assert.ok(searchEmojis("code").some(([emoji]) => emoji === "💻"));
  assert.ok(searchEmojis("money").some(([emoji]) => emoji === "💰"));
  assert.equal(searchEmojis("not-a-real-icon").length, 0);

  const picker = fs.readFileSync(
    new URL("../src/components/EmojiPicker.tsx", import.meta.url),
    "utf8"
  );
  assert.match(picker, /placeholder="Search icons, e\.g\. house"/);
  assert.match(picker, /autoFocus/);
  assert.match(picker, /matches\[0\]\[0\]/);
});
