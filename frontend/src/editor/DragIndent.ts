import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

type DropIntent = "indent" | "outdent" | "same";

const INDENT_THRESHOLD = 28;
const OUTDENT_THRESHOLD = 10;
const INDENT_LINE_WIDTH = 72;
const OUTDENT_LINE_WIDTH = 180;
const BLOCK_SELECTOR =
  "li, .bookmark-card, .video-asset, .rockion-indent, [data-type='callout'], figure, p, h1, h2, h3, blockquote, pre";
const CONTAINER_BLOCK_SELECTOR =
  ".bookmark-card, .video-asset, .rockion-indent, [data-type='callout'], li";

function nearestBlockElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const container = target.closest(CONTAINER_BLOCK_SELECTOR);
  if (container instanceof HTMLElement) return container;
  return target.closest(BLOCK_SELECTOR);
}

function dropIntent(event: DragEvent): DropIntent {
  const block = nearestBlockElement(event.target);
  if (!block) return "same";
  const rect = block.getBoundingClientRect();
  const offset = event.clientX - rect.left;
  if (offset >= INDENT_THRESHOLD) return "indent";
  if (offset <= OUTDENT_THRESHOLD) return "outdent";
  return "same";
}

function dropBlock(event: DragEvent): HTMLElement | null {
  return nearestBlockElement(event.target);
}

function ensureGuide(): HTMLDivElement {
  let guide = document.querySelector(".drag-indent-guide") as HTMLDivElement | null;
  if (!guide) {
    guide = document.createElement("div");
    guide.className = "drag-indent-guide";
    document.body.appendChild(guide);
  }
  return guide;
}

function hideGuide() {
  document.querySelector(".drag-indent-guide")?.remove();
}

function showGuide(event: DragEvent, intent: DropIntent) {
  const block = dropBlock(event);
  if (!block || intent === "same") {
    hideGuide();
    return;
  }
  const rect = block.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  const guide = ensureGuide();
  const indenting = intent === "indent";
  guide.className = `drag-indent-guide is-${intent}`;
  guide.style.left = `${rect.left + (indenting ? 34 : 0)}px`;
  guide.style.top = `${before ? rect.top : rect.bottom}px`;
  guide.style.width = `${indenting ? INDENT_LINE_WIDTH : OUTDENT_LINE_WIDTH}px`;
}

function runIndent(editor: Editor, intent: DropIntent) {
  if (intent === "same") return;

  const tryListIndent = () => {
    for (const type of ["taskItem", "listItem"]) {
      if (editor.commands.sinkListItem(type)) return true;
    }
    return false;
  };

  const tryListOutdent = () => {
    for (const type of ["taskItem", "listItem"]) {
      if (editor.commands.liftListItem(type)) return true;
    }
    return false;
  };

  if (intent === "indent") {
    if (editor.isActive("listItem") || editor.isActive("taskItem")) {
      if (tryListIndent()) return;
    }
    if (editor.chain().focus().wrapIn("indentBlock").run()) return;
    tryListIndent();
    return;
  }

  if (editor.isActive("listItem") || editor.isActive("taskItem")) {
    if (tryListOutdent()) return;
  }
  if (editor.chain().focus().lift("indentBlock").run()) return;
  tryListOutdent();
}

// Adds a Notion-like horizontal intent layer. Lists use native list nesting when
// possible, and arbitrary blocks use Rockion's portable Markdown indent wrapper.
export const DragIndent = Extension.create({
  name: "dragIndent",

  addProseMirrorPlugins() {
    const editor = this.editor;
    let pendingIntent: DropIntent = "same";
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragover(view, event) {
              pendingIntent = dropIntent(event as DragEvent);
              view.dom.dataset.dragIndent = pendingIntent;
              showGuide(event as DragEvent, pendingIntent);
              return false;
            },
            drop(view, event) {
              pendingIntent = dropIntent(event as DragEvent);
              view.dom.dataset.dragIndent = pendingIntent;
              showGuide(event as DragEvent, pendingIntent);
              window.setTimeout(() => {
                runIndent(editor, pendingIntent);
                delete view.dom.dataset.dragIndent;
                hideGuide();
                pendingIntent = "same";
              }, 0);
              return false;
            },
            dragend(view) {
              delete view.dom.dataset.dragIndent;
              hideGuide();
              pendingIntent = "same";
              return false;
            },
            dragleave() {
              hideGuide();
              return false;
            },
          },
        },
      }),
    ];
  },
});
