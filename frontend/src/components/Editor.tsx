import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { editorExtensions } from "../editor/extensions";
import { api, type Note } from "../api";

interface Props {
  note: Note | null;
  onDirtySaved?: () => void;
}

const AUTOSAVE_MS = 600;

export default function Editor({ note, onDirtySaved }: Props) {
  const saveTimer = useRef<number | null>(null);
  const currentPath = useRef<string | null>(null);

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

  if (!note) {
    return (
      <div className="editor-empty">
        <p>Select or create a note to start writing.</p>
      </div>
    );
  }

  return (
    <div className="editor-wrap">
      <EditorContent editor={editor} />
    </div>
  );
}
