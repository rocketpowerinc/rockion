import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { isSafeImageSource } from "../src/editor/imageSources.mjs";
import { shouldHandleSlashMenuKey } from "../src/editor/slashMenuKeys.mjs";
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
  emojiCatalog,
  searchEmojis,
} from "../src/editor/emojiCatalog.mjs";

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

test("only local and explicitly embedded image sources are allowed", () => {
  for (const source of [
    "assets/image.png",
    "./assets/image.png",
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

test("an unmatched slash command does not block Enter", () => {
  assert.equal(shouldHandleSlashMenuKey("Enter", 0), false);
  assert.equal(shouldHandleSlashMenuKey("ArrowDown", 0), false);
  assert.equal(shouldHandleSlashMenuKey("Enter", 1), true);
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

test("the slash menu includes new sub-page creation", () => {
  const source = fs.readFileSync(
    new URL("../src/editor/slashItems.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /title:\s*"New sub-page"/);
  assert.match(source, /rockion:new-sub-page/);
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
