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

const cards = [
  { pageId: "b", title: "Beta", createdAt: 20, modifiedAt: 10 },
  { pageId: "a", title: "Alpha", createdAt: 10, modifiedAt: 30 },
  { pageId: "c", title: "Charlie", createdAt: 30, modifiedAt: 20 },
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
