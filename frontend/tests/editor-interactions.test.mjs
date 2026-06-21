import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isSafeAudioSource,
  parseAudioBlock,
  renderAudioAssetHTML,
  serializeAudioAsset,
  storedAudioSource,
} from "../src/editor/audioMarkup.mjs";
import {
  parseVideoBlock,
  renderVideoAssetHTML,
  serializeVideoAsset,
} from "../src/editor/videoMarkup.mjs";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("paste-as menu inserts immediately and enriches pasted cards in the background", () => {
  const linkPaste = source("../src/editor/LinkPaste.ts");
  const menu = source("../src/editor/LinkPasteMenu.tsx");

  assert.match(linkPaste, /if \(!view\.editable\) return false/);
  assert.match(linkPaste, /SINGLE_URL\.test\(text\)/);
  assert.match(linkPaste, /window\.dispatchEvent\([\s\S]*rockion:link-paste/);
  assert.match(linkPaste, /return true; \/\/ suppress the default paste/);

  const mentionStart = menu.indexOf("const chooseMention");
  const mentionInsert = menu.indexOf('type: "linkMention"', mentionStart);
  const mentionHide = menu.indexOf("setState(null);", mentionStart);
  const mentionPreview = menu.indexOf("const previewPromise = api.fetchLinkPreview", mentionStart);
  assert.ok(mentionStart >= 0 && mentionInsert > mentionStart);
  assert.ok(mentionHide > mentionInsert);
  assert.ok(mentionPreview > mentionHide);

  const bookmarkStart = menu.indexOf("const chooseBookmark");
  const bookmarkInsert = menu.indexOf('type: "bookmark"', bookmarkStart);
  const bookmarkHide = menu.indexOf("setState(null);", bookmarkStart);
  const bookmarkPreview = menu.indexOf("const previewPromise = api.fetchLinkPreview", bookmarkStart);
  assert.ok(bookmarkStart >= 0 && bookmarkInsert > bookmarkStart);
  assert.ok(bookmarkHide > bookmarkInsert);
  assert.ok(bookmarkPreview > bookmarkHide);

  assert.match(menu, /const faviconPromise = downloadFavicon\(pasted\.url\)/);
  assert.match(menu, /updateMatchingNodes\("bookmark",\s*pasted\.url/);
  assert.match(menu, /updateMatchingNodes\("linkMention",\s*pasted\.url/);
  assert.match(menu, /Dismissing without a choice still inserts the plain URL/);
});

test("audio and video assets reject remote sources and round-trip portable markup", () => {
  const audio = serializeAudioAsset(
    { src: "/Assets/Audio/note-clip.mp3", title: 'Voice "Memo"' },
    "listen <now>"
  );
  assert.match(audio, /^<figure data-rockion-audio>/);
  assert.deepEqual(parseAudioBlock(audio), {
    src: "Assets/Audio/note-clip.mp3",
    title: 'Voice "Memo"',
    caption: "listen <now>",
  });
  assert.equal(
    renderAudioAssetHTML(audio),
    '<figure data-rockion-audio><audio src="/Assets/Audio/note-clip.mp3" controls preload="metadata" title="Voice &quot;Memo&quot;"></audio><figcaption>listen &lt;now&gt;</figcaption></figure>\n'
  );
  assert.equal(storedAudioSource("\\Assets\\Audio\\clip.weba"), "Assets/Audio/clip.weba");
  assert.equal(isSafeAudioSource("Assets/Audio/clip.flac"), true);
  assert.equal(isSafeAudioSource("Assets/Videos/not-audio.mp4"), false);
  assert.equal(parseAudioBlock('<audio src="https://example.com/track.mp3"></audio>'), null);

  const video = serializeVideoAsset(
    { src: "/Assets/Videos/demo.mp4", title: "Demo" },
    "watch"
  );
  assert.deepEqual(parseVideoBlock(video), {
    src: "Assets/Videos/demo.mp4",
    title: "Demo",
    caption: "watch",
  });
  assert.equal(
    renderVideoAssetHTML(video),
    '<figure data-rockion-video><video src="/Assets/Videos/demo.mp4" controls preload="metadata" title="Demo"></video><figcaption>watch</figcaption></figure>\n'
  );
  assert.equal(parseVideoBlock('<video src="file:///C:/secret.mp4"></video>'), null);
});

test("tab persistence, reordering, and reopen shortcuts stay wired together", () => {
  const app = source("../src/App.tsx");
  const tabs = source("../src/components/PageTabs.tsx");

  assert.match(app, /const vaultTabsKey = vault \? `rockion-open-tabs:\$\{vault\.path\}` : ""/);
  assert.match(app, /localStorage\.getItem\(vaultTabsKey\)/);
  assert.match(app, /localStorage\.setItem\(vaultTabsKey,\s*JSON\.stringify\(openTabs\)\)/);
  assert.match(app, /setClosedTabs\(\(stack\) => \[\.\.\.stack,\s*closing\]\)/);
  assert.match(app, /const tab = closedTabs\[closedTabs\.length - 1\]/);
  assert.match(app, /setClosedTabs\(\(current\) => current\.slice\(0,\s*-1\)\)/);
  assert.match(app, /!!current\[from\]\.pinned !== !!current\[to\]\.pinned/);
  assert.match(app, /setTabPickerOpen\(true\)/);
  assert.match(app, /isEditableShortcutTarget\(e\.target\)/);

  assert.match(tabs, /draggable/);
  assert.match(tabs, /event\.dataTransfer\.setData\("text\/plain",\s*tab\.path\)/);
  assert.match(tabs, /!!dragged\.pinned === !!target\.pinned/);
  assert.match(tabs, /onReorder\(from,\s*tab\.path\)/);
  assert.match(tabs, /onContextMenu/);
  assert.match(tabs, /Close all tabs/);
});

test("locked pages suppress editing affordances and write-sensitive shortcuts", () => {
  const editor = source("../src/components/Editor.tsx");
  const addBlock = source("../src/editor/AddBlockButton.ts");
  const linkPaste = source("../src/editor/LinkPaste.ts");
  const toolbar = source("../src/components/SelectionToolbar.tsx");
  const styles = source("../src/styles.css");

  assert.match(editor, /editor\.setEditable\(!pageSettings\.locked\)/);
  assert.match(editor, /toggleAttribute\("data-locked",\s*pageSettings\.locked\)/);
  assert.match(editor, /className=\{`editor-wrap[\s\S]*pageSettings\.locked \? "is-locked"/);
  assert.match(addBlock, /if \(!view\.editable\) return this\.hide\(\)/);
  assert.match(linkPaste, /if \(!view\.editable\) return false/);
  assert.match(toolbar, /locked \|\|[\s\S]*!editor\.isEditable/);
  assert.match(styles, /\.rk-prose\[data-locked\] > \*:hover[\s\S]*transparent/);
  assert.match(styles, /\.editor-wrap\.is-locked \.add-block-button[\s\S]*display:\s*none !important/);
});

test("in-page find wraps movement and includes searchable bookmark text", () => {
  const pageFind = source("../src/editor/PageFind.ts");

  assert.match(pageFind, /function findMatches\(doc: ProseMirrorNode, query: string\)/);
  assert.match(pageFind, /const needle = query\.trim\(\)\.toLowerCase\(\)/);
  assert.match(pageFind, /while \(offset >= 0\)/);
  assert.match(pageFind, /haystack\.indexOf\(needle, offset \+ Math\.max\(needle\.length, 1\)\)/);
  assert.match(pageFind, /function searchableAtomText\(node: ProseMirrorNode\): string/);
  assert.match(pageFind, /case "bookmark":[\s\S]*attrs\.description[\s\S]*attrs\.siteName[\s\S]*attrs\.url/);
  assert.match(pageFind, /case "linkMention":[\s\S]*attrs\.title[\s\S]*attrs\.url/);
  assert.match(pageFind, /return \(\(index % length\) \+ length\) % length/);
  assert.match(pageFind, /return setPageFind\(editor, current\.query, current\.index \+ direction\)/);
  assert.match(pageFind, /setMeta\(pageFindKey, \{ clear: true \}/);
  assert.match(pageFind, /tr\.docChanged && previous\.query/);
  assert.match(pageFind, /Decoration\.node\(match\.from, match\.to, attrs\)/);
  assert.match(pageFind, /Decoration\.inline\(match\.from, match\.to, attrs\)/);
});

test("title-to-filename rename waits for save and updates local navigation state", () => {
  const editor = source("../src/components/Editor.tsx");
  const app = source("../src/App.tsx");

  const renameBlockStart = editor.indexOf("const syncTitle");
  const saveBeforeRename = editor.indexOf("const saved = await saveNowRef.current()", renameBlockStart);
  const desiredTitle = editor.indexOf("const desired = firstHeadingTitle(markdownNow())", renameBlockStart);
  const renameCall = editor.indexOf("api.renameToTitle(path, desired)", renameBlockStart);
  assert.ok(renameBlockStart >= 0);
  assert.ok(saveBeforeRename > renameBlockStart);
  assert.ok(desiredTitle > saveBeforeRename);
  assert.ok(renameCall > desiredTitle);
  assert.match(editor, /if \(!saved \|\| currentPath\.current !== path \|\| conflictRef\.current\) return/);
  assert.match(editor, /version\.current = renamed\.version/);
  assert.match(editor, /currentPath\.current = renamed\.path/);
  assert.match(editor, /onNoteRenamedRef\.current\?\.\(renamed\)/);
  assert.match(editor, /renameInFlight\.current = op/);

  assert.match(app, /onNoteRenamed=\{\(renamed\) => \{/);
  assert.match(app, /const previousPath = note\?\.path/);
  assert.match(app, /previousPath && previousPath !== renamed\.path/);
  assert.match(app, /setNavigationHistory\(\(current\) =>\s*current\.map\(\(path\) =>/);
  assert.match(app, /setOpenTabs\(\(current\) =>\s*current\.map\(\(tab\) =>/);
  assert.match(app, /path: renamed\.path/);
  assert.match(app, /title: renamed\.title/);
  assert.match(app, /path === previousPath \? renamed\.path : path/);
  assert.match(app, /void refreshTree\(\)/);
});
