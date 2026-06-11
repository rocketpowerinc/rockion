import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { editorExtensions } from "../editor/extensions";
import { api, type Note } from "../api";
import PagePicker, { type PageRef } from "./PagePicker";

interface Props {
  note: Note | null;
  pages?: PageRef[];
  onDirtySaved?: () => void;
  onOpenLink?: (path: string) => void;
}

const AUTOSAVE_MS = 600;

export default function Editor({ note, pages, onDirtySaved, onOpenLink }: Props) {
  const saveTimer = useRef<number | null>(null);
  const currentPath = useRef<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    editorProps: {
      attributes: { class: "rk-prose" },
      handlePaste: (_view, event) => handleImagePaste(event),
      handleDrop: (_view, event) => handleImageDrop(event),
    },
    onUpdate: ({ editor }) => {
      if (!currentPath.current) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const path = currentPath.current;
      saveTimer.current = window.setTimeout(async () => {
        const md = editor.storage?.markdown?.getMarkdown?.() ?? editor.getText();
        await api.writeNote(path, md);
        onDirtySaved?.();
      }, AUTOSAVE_MS);
    },
  });

  // Insert an uploaded image at the cursor and persist to assets/.
  async function saveAndInsert(file: File) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const relPath = await api.saveImage(file.name, Array.from(buf));
    editor?.chain().focus().setImage({ src: relPath, alt: file.name }).run();
  }

  function handleImagePaste(event: ClipboardEvent): boolean {
    const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
      i.type.startsWith("image/")
    );
    if (!item) return false;
    const file = item.getAsFile();
    if (file) void saveAndInsert(file);
    return true;
  }

  function handleImageDrop(event: DragEvent): boolean {
    const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
      f.type.startsWith("image/")
    );
    if (!file) return false;
    event.preventDefault();
    void saveAndInsert(file);
    return true;
  }

  // Load note content when the selected note changes.
  useEffect(() => {
    if (!editor) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    currentPath.current = note?.path ?? null;
    try {
      editor.commands.setContent(note?.markdown ?? "", false);
    } catch (e) {
      // Fall back to plain text if markdown parsing chokes on this file.
      console.error("setContent failed, falling back to plain text:", e);
      editor.commands.setContent(
        { type: "doc", content: [{ type: "paragraph", content: note?.markdown ? [{ type: "text", text: note.markdown }] : [] }] },
        false
      );
    }
  }, [editor, note?.path]);

  // Open the page picker when the "/Link to page" command fires.
  useEffect(() => {
    const open = () => setLinkPickerOpen(true);
    window.addEventListener("rockion:link-page", open);
    return () => window.removeEventListener("rockion:link-page", open);
  }, []);

  // Insert a markdown link to the chosen note at the cursor.
  function insertPageLink(page: PageRef) {
    setLinkPickerOpen(false);
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: "text", text: page.title, marks: [{ type: "link", attrs: { href: page.path } }] },
        { type: "text", text: " " },
      ])
      .run();
  }

  // Clicking the empty area below the content starts a new block there.
  function handleWrapClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!editor) return;

    // Internal links (to other notes) open that note instead of navigating.
    const anchor = (e.target as HTMLElement)?.closest?.("a");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (href && !/^(https?:|mailto:|tel:|#)/i.test(href)) {
        e.preventDefault();
        onOpenLink?.(decodeURIComponent(href));
      }
      return;
    }

    if (e.target !== e.currentTarget) return; // ignore clicks on actual content
    const pmRect = editor.view.dom.getBoundingClientRect();
    if (e.clientY < pmRect.bottom) return; // only when clicking *below* content

    const last = editor.state.doc.lastChild;
    const isEmptyParagraph =
      !!last && last.type.name === "paragraph" && last.content.size === 0;
    if (isEmptyParagraph) {
      editor.chain().focus("end").run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, { type: "paragraph" })
        .focus("end")
        .run();
    }
  }

  if (!note) {
    return (
      <div className="editor-empty">
        <p>Select or create a note to start writing.</p>
      </div>
    );
  }

  return (
    <>
      <div className="editor-wrap" onClick={handleWrapClick}>
        <EditorContent editor={editor} />
      </div>
      <PagePicker
        open={linkPickerOpen}
        pages={pages ?? []}
        onPick={insertPageLink}
        onClose={() => setLinkPickerOpen(false)}
      />
    </>
  );
}
