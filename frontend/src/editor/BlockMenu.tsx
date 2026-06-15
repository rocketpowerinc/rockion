import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TEXT_COLORS, BG_COLORS } from "./colorMarks";
import { transformBlockJSON } from "./blockTransforms.mjs";

interface Props {
  editor: Editor | null;
}

type Sub = null | "turn" | "color";

const BLOCK_MENU_WIDTH = 184;
const BLOCK_MENU_GAP = 6;
const VIEWPORT_GUTTER = 8;

interface MenuState {
  x: number;
  y: number;
  from: number; // start pos of the target top-level block
}

const TURN_INTO = [
  { label: "Text", target: "text" },
  { label: "Heading 1", target: "heading1" },
  { label: "Heading 2", target: "heading2" },
  { label: "Heading 3", target: "heading3" },
  { label: "Bulleted list", target: "bullet" },
  { label: "Numbered list", target: "ordered" },
  { label: "To-do list", target: "task" },
  { label: "Quote", target: "quote" },
  { label: "Code", target: "code" },
  { label: "Callout", target: "callout" },
];

// Notion-style block menu. Opens when the drag grip (".drag-handle") is clicked
// and acts on that block: turn into, color, duplicate, delete.
export default function BlockMenu({ editor }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setMenu(null);
    setSub(null);
  }, []);

  // Open the menu when the drag grip is clicked.
  useEffect(() => {
    if (!editor) return;
    const onClick = (event: MouseEvent) => {
      const handle = (event.target as HTMLElement)?.closest?.(".drag-handle");
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      const view = editor.view;
      const handleRect = (handle as HTMLElement).getBoundingClientRect();
      const contentRect = view.dom.getBoundingClientRect();
      const found = view.posAtCoords({
        left: contentRect.left + 24,
        top: handleRect.top + handleRect.height / 2,
      });
      if (!found) return;
      const $pos = view.state.doc.resolve(found.pos);
      if ($pos.depth < 1) return;
      const from = $pos.before(1);
      // The page title is the first block (an H1) — it's not editable via this
      // menu, so don't open at all for it.
      const block = view.state.doc.nodeAt(from);
      if (from === 0 && block?.type.name === "heading") return;
      setMenu({
        x: Math.max(
          VIEWPORT_GUTTER,
          handleRect.left - BLOCK_MENU_GAP - BLOCK_MENU_WIDTH
        ),
        y: handleRect.top,
        from,
      });
      setSub(null);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [editor]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  if (!editor || !menu) return null;

  const node = editor.state.doc.nodeAt(menu.from);
  if (!node) return null;
  const to = menu.from + node.nodeSize;

  const turnInto = (target: string) => {
    const content = transformBlockJSON(node.toJSON(), target);
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: menu.from, to },
        content,
        { updateSelection: true, errorOnInvalidContent: true }
      )
      .run();
    close();
  };

  const applyColor = (markName: "textColor" | "bgColor", attrs: Record<string, string>) => {
    editor
      .chain()
      .focus()
      .setTextSelection({ from: menu.from + 1, to: to - 1 })
      .setMark(markName, attrs)
      .run();
  };

  const clearBackgroundColor = () => {
    editor
      .chain()
      .focus()
      .setTextSelection({ from: menu.from + 1, to: to - 1 })
      .unsetMark("bgColor")
      .run();
  };

  const clearColor = () => {
    editor
      .chain()
      .focus()
      .setTextSelection({ from: menu.from + 1, to: to - 1 })
      .unsetMark("textColor")
      .unsetMark("bgColor")
      .run();
  };

  const duplicate = () => {
    editor.chain().focus().insertContentAt(to, node.toJSON()).run();
    close();
  };

  const remove = () => {
    editor.chain().focus().deleteRange({ from: menu.from, to }).run();
    close();
  };

  return (
    <div
      ref={ref}
      className="block-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="block-menu-item has-sub"
        onMouseEnter={() => setSub("turn")}
        onClick={() => setSub(sub === "turn" ? null : "turn")}
      >
        <span>Turn into</span>
        <span className="block-menu-caret">›</span>
      </button>
      <button
        className="block-menu-item has-sub"
        onMouseEnter={() => setSub("color")}
        onClick={() => setSub(sub === "color" ? null : "color")}
      >
        <span>Color</span>
        <span className="block-menu-caret">›</span>
      </button>
      <div className="block-menu-sep" />
      <button className="block-menu-item" onMouseEnter={() => setSub(null)} onClick={duplicate}>
        Duplicate
      </button>
      <button
        className="block-menu-item is-danger"
        onMouseEnter={() => setSub(null)}
        onClick={remove}
      >
        Delete
      </button>

      {sub === "turn" && (
        <div className="block-submenu">
          {TURN_INTO.map((item) => (
            <button
              key={item.label}
              className="block-menu-item"
              onClick={() => turnInto(item.target)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {sub === "color" && (
        <div className="block-submenu block-color-menu">
          <div className="block-color-label">Text</div>
          <div className="block-swatches">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                className="block-swatch"
                title={c.name}
                style={{ color: c.value }}
                onClick={() => applyColor("textColor", { color: c.value })}
              >
                A
              </button>
            ))}
          </div>
          <div className="block-color-label">Background</div>
          <div className="block-swatches">
            {BG_COLORS.map((c) => (
              <button
                key={c.value}
                className="block-swatch block-swatch-bg"
                title={c.name}
                style={{ background: c.value }}
                onClick={() => applyColor("bgColor", { background: c.value })}
              />
            ))}
          </div>
          <button className="block-menu-item" onClick={clearBackgroundColor}>
            Remove background
          </button>
          <div className="block-menu-sep" />
          <button className="block-menu-item" onClick={clearColor}>
            Reset all colors
          </button>
        </div>
      )}
    </div>
  );
}
