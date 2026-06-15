import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { BubbleMenu, type Editor } from "@tiptap/react";
import { normalizeExternalHref } from "../editor/externalLinks.mjs";

interface Props {
  editor: Editor | null;
  locked: boolean;
}

export default function SelectionToolbar({ editor, locked }: Props) {
  const [linkEditing, setLinkEditing] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    setLinkEditing(false);
    setHref("");
    setLinkError("");
  }, [editor?.state.selection.from, editor?.state.selection.to]);

  if (!editor) return null;

  function preserveSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function beginLink() {
    setHref(editor?.getAttributes("link").href || "");
    setLinkError("");
    setLinkEditing(true);
  }

  function saveLink(event: FormEvent) {
    event.preventDefault();
    if (!href.trim()) {
      editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkEditing(false);
      return;
    }
    const value = normalizeExternalHref(href);
    if (!value) {
      setLinkError("Enter a web address such as example.com or https://example.com.");
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
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

  return (
    <BubbleMenu
      editor={editor}
      className="selection-toolbar"
      tippyOptions={{ duration: 100, placement: "top", maxWidth: "none" }}
      shouldShow={({ editor: current, from, to }) =>
        !locked && current.isEditable && from !== to
      }
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
    </BubbleMenu>
  );
}
