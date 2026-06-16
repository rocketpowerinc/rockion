import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { normalizeExternalHref } from "../editor/externalLinks.mjs";
import { selectionTouchesPageTitle } from "../editor/PageTitlePlainText";

interface Props {
  editor: Editor | null;
  locked: boolean;
}

export default function SelectionToolbar({ editor, locked }: Props) {
  const [linkEditing, setLinkEditing] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);
  const [, setRevision] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setVisible(false);
      return;
    }
    const { from, to, empty } = editor.state.selection;
    const toolbarFocused = !!toolbarRef.current?.contains(document.activeElement);
    if (
      locked ||
      !editor.isEditable ||
      empty ||
      selectionTouchesPageTitle(editor.state) ||
      (!editor.isFocused && !toolbarFocused)
    ) {
      setVisible(false);
      return;
    }
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const center = Math.max(150, Math.min(window.innerWidth - 150, (start.left + end.right) / 2));
      const above = Math.min(start.top, end.top) - 46;
      setPosition({
        left: center,
        top: above >= 8 ? above : Math.max(start.bottom, end.bottom) + 8,
      });
      setVisible(true);
      setRevision((value) => value + 1);
    } catch {
      setVisible(false);
    }
  }, [editor, locked]);

  useEffect(() => {
    setLinkEditing(false);
    setHref("");
    setLinkError("");
    setVisible(false);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => update();
    const refreshAfterBlur = () => window.setTimeout(update, 0);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    editor.on("focus", refresh);
    editor.on("blur", refreshAfterBlur);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    update();
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
      editor.off("focus", refresh);
      editor.off("blur", refreshAfterBlur);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [editor, update]);

  if (!editor) return null;

  function preserveSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function beginLink() {
    setHref(editor?.getAttributes("link").href || "");
    setLinkError("");
    setLinkEditing(true);
    window.setTimeout(update, 0);
  }

  function saveLink(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    let command = editor.chain().focus();
    if (!href.trim()) {
      if (editor.isActive("link")) command = command.extendMarkRange("link");
      command.unsetLink().run();
      setLinkEditing(false);
      return;
    }
    const value = normalizeExternalHref(href);
    if (!value) {
      setLinkError("Enter a web address such as example.com or https://example.com.");
      return;
    }
    if (editor.isActive("link")) command = command.extendMarkRange("link");
    command.setLink({ href: value }).run();
    setLinkEditing(false);
  }

  const action = (
    label: string,
    title: string,
    active: boolean,
    run: () => void
  ) => (
    <button
      type="button"
      className={active ? "is-active" : ""}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={preserveSelection}
      onClick={run}
    >
      {label}
    </button>
  );

  if (!visible && !linkEditing) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{ left: position.left, top: position.top }}
      onMouseDown={() => window.setTimeout(update, 0)}
    >
      {linkEditing ? (
        <form className="selection-link-form" onSubmit={saveLink}>
          <input
            autoFocus
            value={href}
            aria-label="Link URL"
            placeholder="Paste or type a link…"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkEditing(false);
                editor.commands.focus();
              }
            }}
          />
          <button type="submit">Apply</button>
          {linkError && <span className="selection-link-error">{linkError}</span>}
        </form>
      ) : (
        <>
          {action("B", "Bold", editor.isActive("bold"), () =>
            editor.chain().focus().toggleBold().run()
          )}
          {action("I", "Italic", editor.isActive("italic"), () =>
            editor.chain().focus().toggleItalic().run()
          )}
          {action("U", "Underline", editor.isActive("underline"), () =>
            editor.chain().focus().toggleUnderline().run()
          )}
          {action("S", "Strikethrough", editor.isActive("strike"), () =>
            editor.chain().focus().toggleStrike().run()
          )}
          {action("</>", "Inline code", editor.isActive("code"), () =>
            editor.chain().focus().toggleCode().run()
          )}
          <span className="selection-toolbar-separator" />
          <button
            type="button"
            className={editor.isActive("link") ? "is-active" : ""}
            title="Add or edit link"
            aria-label="Add or edit link"
            aria-pressed={editor.isActive("link")}
            onMouseDown={preserveSelection}
            onClick={beginLink}
          >
            Link
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
