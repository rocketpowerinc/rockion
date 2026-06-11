import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const BUTTON_HEIGHT = 24;
const BUTTON_WIDTH = 22;
const GRIP_GAP = 6; // constant horizontal gap between "+" and the drag grip // keep in sync with .add-block-button height in CSS

// Notion-style "+" button that follows the hovered block in the left gutter.
// Clicking it inserts an empty paragraph directly below that block.
//
// It tracks the pointer at the document level (not on the editor element) and
// uses fixed positioning, so the button stays visible while you move out into
// the gutter to click it — moving onto it never hides it.
export const AddBlockButton = Extension.create({
  name: "addBlockButton",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-add-block"),
        view: (view) => new AddBlockView(view),
      }),
    ];
  },
});

class AddBlockView {
  private view: EditorView;
  private button: HTMLButtonElement;
  private blockPos: number | null = null;
  private dragging = false;

  constructor(view: EditorView) {
    this.view = view;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "add-block-button";
    this.button.textContent = "+";
    this.button.title = "Add block below";
    this.button.style.position = "fixed";
    this.button.style.display = "none";
    this.button.addEventListener("mousedown", this.handleClick);
    document.body.appendChild(this.button);
    document.addEventListener("mousemove", this.handleMove);
    // Hide the "+" while a block is being dragged (drag grip uses HTML5 drag).
    document.addEventListener("dragstart", this.onDragStart, true);
    document.addEventListener("dragend", this.onDragEnd, true);
    document.addEventListener("drop", this.onDragEnd, true);
  }

  private onDragStart = () => {
    this.dragging = true;
    this.hide();
  };
  private onDragEnd = () => {
    this.dragging = false;
  };

  private hide = () => {
    this.button.style.display = "none";
    this.blockPos = null;
  };

  private handleMove = (event: MouseEvent) => {
    const view = this.view;
    if (this.dragging) return;
    if (!view.dom.isConnected) return this.hide();

    const r = view.dom.getBoundingClientRect();
    // "Hot zone" = the content column plus the left gutter where the button sits.
    const inZone =
      event.clientX >= r.left - 64 &&
      event.clientX <= r.right &&
      event.clientY >= r.top - 4 &&
      event.clientY <= r.bottom + 4;
    if (!inZone) return this.hide();

    // Sample inside the content column at the pointer's Y to find the block.
    const found = view.posAtCoords({ left: r.left + 24, top: event.clientY });
    if (!found) return; // stay put while inside the zone

    const $pos = view.state.doc.resolve(found.pos);
    if ($pos.depth < 1) return;

    const blockPos = $pos.before(1);
    const dom = view.nodeDOM(blockPos);
    if (!(dom instanceof HTMLElement)) return;

    // Vertically center the button on the block's first text line.
    const b = dom.getBoundingClientRect();
    const style = getComputedStyle(dom);
    let lineHeight = parseFloat(style.lineHeight);
    if (Number.isNaN(lineHeight)) lineHeight = parseFloat(style.fontSize) * 1.4;
    const padTop = parseFloat(style.paddingTop) || 0;
    const top = b.top + padTop + (lineHeight - BUTTON_HEIGHT) / 2;

    // Anchor horizontally to the drag grip so the gap between "+" and grip is
    // identical for every block type (lists, callouts, headings shift the grip).
    let left = b.left - 52;
    const grip = document.querySelector(".drag-handle") as HTMLElement | null;
    if (grip && !grip.classList.contains("hide")) {
      const gr = grip.getBoundingClientRect();
      if (gr.width > 0) left = gr.left - GRIP_GAP - BUTTON_WIDTH;
    }

    this.blockPos = blockPos;
    this.button.style.display = "flex";
    this.button.style.left = `${left}px`;
    this.button.style.top = `${top}px`;
  };

  private handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.blockPos == null) return;
    const view = this.view;
    const { state } = view;

    // End position of the hovered top-level block.
    const endOfBlock = state.doc.resolve(this.blockPos + 1).after(1);
    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return;

    let tr = state.tr.insert(endOfBlock, paragraph);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(endOfBlock + 1)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  destroy() {
    document.removeEventListener("mousemove", this.handleMove);
    document.removeEventListener("dragstart", this.onDragStart, true);
    document.removeEventListener("dragend", this.onDragEnd, true);
    document.removeEventListener("drop", this.onDragEnd, true);
    this.button.remove();
  }
}
