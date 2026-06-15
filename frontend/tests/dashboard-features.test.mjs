import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import MarkdownIt from "markdown-it";
import {
  reorderedDashboardIDs,
  sortDashboardCards,
} from "../src/editor/dashboardModel.mjs";
import {
  backgroundColorStyle,
  textColorStyle,
} from "../src/editor/colorMarkup.mjs";
import {
  clampCoverPosition,
  coverPositionFromDrag,
} from "../src/editor/coverPosition.mjs";

const cards = [
  { pageId: "b", title: "Beta", tag: "Other", createdAt: 20, modifiedAt: 10 },
  { pageId: "a", title: "Alpha", tag: "CheatSheets", createdAt: 10, modifiedAt: 30 },
  { pageId: "c", title: "Charlie", tag: "Bootstraps", createdAt: 30, modifiedAt: 20 },
];

test("dashboard sorting is derived without mutating manual order", () => {
  assert.deepEqual(
    sortDashboardCards(cards, { sortBy: "title", sortDir: "asc" }).map(
      (card) => card.pageId
    ),
    ["a", "b", "c"]
  );
  assert.deepEqual(
    sortDashboardCards(cards, { sortBy: "modified", sortDir: "desc" }).map(
      (card) => card.pageId
    ),
    ["a", "c", "b"]
  );
  assert.deepEqual(
    sortDashboardCards(cards, { sortBy: "tag", sortDir: "asc" }).map(
      (card) => card.pageId
    ),
    ["c", "a", "b"]
  );
  assert.deepEqual(cards.map((card) => card.pageId), ["b", "a", "c"]);
});

test("manual dashboard reordering produces a complete stable ID list", () => {
  assert.deepEqual(reorderedDashboardIDs(cards, "b", "c"), ["a", "c", "b"]);
  assert.deepEqual(reorderedDashboardIDs(cards, "missing", "c"), ["b", "a", "c"]);
});

test("dashboard cards expose deletion, lazy thumbnails, and manual-only dragging", () => {
  const source = fs.readFileSync(
    new URL("../src/components/DashboardCards.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /coverThumbnailDataURL/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /draggable=\{manualOrder\}/);
  assert.match(source, /onDelete\(card\)/);
  assert.match(source, /<PageTag tag=\{card\.tag\} color=\{card\.tagColor\}/);
  assert.match(source, /className="db-list-header"/);
  assert.match(source, />Tag<\/span>/);
  assert.match(source, /objectPosition:\s*`center \$\{card\.cover\?\.position \?\? 50\}%`/);
  assert.match(source, /<img[\s\S]*src=\{thumbnail\}/);
});

test("cover repositioning converts vertical drag into a bounded saved position", () => {
  assert.equal(coverPositionFromDrag(50, -50, 200), 75);
  assert.equal(coverPositionFromDrag(50, 50, 200), 25);
  assert.equal(clampCoverPosition(49.130434782608695), 49);
  assert.equal(clampCoverPosition(-10), 0);
  assert.equal(clampCoverPosition(140), 100);

  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  const controls = fs.readFileSync(
    new URL("../src/components/CoverRepositionControls.tsx", import.meta.url),
    "utf8"
  );
  assert.match(editor, /Reposition/);
  assert.match(controls, /Save position/);
  assert.match(controls, /Drag image to reposition/);
  assert.match(dashboard, /Reposition/);
  assert.match(dashboard, /coverPositionFromDrag/);
});

test("opened managed pages show their template tag beside the favorite star", () => {
  const editor = fs.readFileSync(
    new URL("../src/components/Editor.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(editor, /className="page-header-tag"/);
  assert.match(editor, /tag=\{note\.tag\}/);
  assert.ok(editor.indexOf('className="page-header-tag"') < editor.indexOf("favorite-button"));
  assert.match(styles, /\.page-header-tag\s*\{[\s\S]*right:\s*98px/);
});

test("external vault revisions reload an open dashboard", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  assert.match(app, /setVaultRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(app, /refreshVersion=\{vaultRevision\}/);
  assert.match(dashboard, /\[reload, note\.version, refreshVersion\]/);
});

test("project dashboards expose editable names and cover-overlapping icons", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(dashboard, /onRenameProject\(note\.path,\s*desired\)/);
  assert.match(dashboard, /className="db-title-input"/);
  assert.match(dashboard, /aria-label="Project name"/);
  assert.match(app, /const renameProject = useCallback/);
  assert.match(app, /api\.renameProject\(dashboardPath,\s*title\)/);
  assert.match(styles, /\.db-header\.has-cover\s*\{[\s\S]*margin-top:\s*-34px/);
  assert.match(styles, /\.db-title-icon\s*\{[\s\S]*font-size:\s*46px/);
});

test("sidebar labels root folders as projects and exposes hover rename controls", () => {
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(sidebar, /<SidebarSection title="Projects">/);
  assert.doesNotMatch(sidebar, /<SidebarSection title="Folders">/);
  assert.match(sidebar, /className="project-more-button"/);
  assert.match(sidebar, />\s*Rename\s*</);
  assert.match(sidebar, /className="project-name-input"/);
  assert.match(styles, /\.project-row:hover \.project-more-button[\s\S]*opacity:\s*1/);
});

test("dashboard templates are loaded from the vault into the new-page modal", () => {
  const dashboard = fs.readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8"
  );
  const modal = fs.readFileSync(
    new URL("../src/components/NewPageModal.tsx", import.meta.url),
    "utf8"
  );
  assert.match(dashboard, /api\.listPageTemplates\(\)/);
  assert.match(dashboard, /templates=\{templates\}/);
  assert.doesNotMatch(dashboard, /const TEMPLATES/);
  assert.doesNotMatch(dashboard, /Meeting note/);
  assert.doesNotMatch(dashboard, />\s*Template\s*<select/);
  assert.match(modal, /className="new-page-template"/);
  assert.match(modal, /await onSubmit\(title, template\)/);
});

test("color span markup survives the configured Markdown HTML round trip", () => {
  const textStyle = textColorStyle("#39ff14");
  const backgroundStyle = backgroundColorStyle("rgba(0, 229, 255, 0.20)");
  const markdown = `Before <span style="${textStyle}">green</span> and <span style="${backgroundStyle}">cyan</span>.`;
  const rendered = new MarkdownIt({ html: true, linkify: false }).render(markdown);
  assert.match(rendered, /<span style="color: #39ff14">green<\/span>/);
  assert.match(
    rendered,
    /<span style="background-color: rgba\(0, 229, 255, 0.20\); border-radius: 3px; padding: 0 2px">cyan<\/span>/
  );

  const extensions = fs.readFileSync(
    new URL("../src/editor/extensions.ts", import.meta.url),
    "utf8"
  );
  assert.match(extensions, /Markdown\.configure\(\{[\s\S]*html:\s*true/);
});
