import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

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

  private handleMove = () => {
    const view = this.view;
    if (this.dragging) return;
    if (!view.editable) return this.hide();
    if (!view.dom.isConnected) return this.hide();

    // Mirror the drag grip: the "+" only appears when the library shows the grip
    // (i.e. while hovering a block), sits directly left of it, and shares its top
    // edge so the two buttons are always at the same height.
    const grip = document.querySelector(".drag-handle") as HTMLElement | null;
    if (!grip || grip.classList.contains("hide")) return this.hide();
    const gr = grip.getBoundingClientRect();
    if (gr.width === 0 || gr.height === 0) return this.hide();

    // Resolve the hovered block from the grip's vertical center for the click action.
    const r = view.dom.getBoundingClientRect();
    const found = view.posAtCoords({ left: r.left + 24, top: gr.top + gr.height / 2 });
    if (!found) return this.hide();
    const $pos = view.state.doc.resolve(found.pos);
    if ($pos.depth < 1) return this.hide();
    const blockPos = $pos.before(1);

    // The page title is the first block (an H1) — show no "+" or grip beside it.
    // visibility (not display) keeps the grip measurable so it restores cleanly
    // once the pointer moves to another block.
    const node = view.state.doc.nodeAt(blockPos);
    if (blockPos === 0 && node?.type.name === "heading") {
      grip.style.visibility = "hidden";
      return this.hide();
    }
    grip.style.visibility = "";

    this.blockPos = blockPos;
    this.button.style.display = "flex";
    this.button.style.left = `${gr.left - GRIP_GAP - BUTTON_WIDTH}px`;
    this.button.style.top = `${gr.top}px`;
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
