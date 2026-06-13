import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { isSafeImageSource } from "../src/editor/imageSources.mjs";
import { shouldHandleSlashMenuKey } from "../src/editor/slashMenuKeys.mjs";
import nspell from "nspell";
import englishDictionary from "dictionary-en";
import frenchDictionary from "dictionary-fr";

test("plain markdown filenames are not fuzzy-linked", () => {
  const source = fs.readFileSync(new URL("../src/editor/extensions.ts", import.meta.url), "utf8");
  assert.match(source, /Markdown\.configure\(\{[\s\S]*linkify:\s*false/);

  const parser = new MarkdownIt({ html: false, linkify: false });
  assert.equal(parser.render("notes.md"), "<p>notes.md</p>\n");
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
