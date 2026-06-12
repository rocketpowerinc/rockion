import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { editorExtensions } from "../editor/extensions";
import { api, onVaultChanged, type Note } from "../api";
import PagePicker, { type PageRef } from "./PagePicker";
import EmojiPicker from "./EmojiPicker";

interface Props {
  note: Note | null;
  pages?: PageRef[];
  onDirtySaved?: () => void;
  onOpenLink?: (path: string) => void;
  onSetIcon?: (path: string, icon: string) => void;
  onNoteUpdated?: (note: Note) => void;
}

export interface EditorHandle {
  flushSave: () => Promise<boolean>;
}

interface Conflict {
  remote: Note;
  localMarkdown: string;
}

const AUTOSAVE_MS = 600;

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { note, pages, onDirtySaved, onOpenLink, onSetIcon, onNoteUpdated },
  ref
) {
  const saveTimer = useRef<number | null>(null);
  const currentPath = useRef<string | null>(null);
  const version = useRef("");
  const dirty = useRef(false);
  const conflictRef = useRef<Conflict | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const clearSaveTimer = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    editorProps: {
      attributes: { class: "rk-prose" },
      handlePaste: (_view, event) => handleImagePaste(event),
      handleDrop: (_view, event) => handleImageDrop(event),
    },
    onUpdate: () => {
      if (!currentPath.current || conflictRef.current) return;
      dirty.current = true;
      clearSaveTimer();
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void saveNowRef.current();
      }, AUTOSAVE_MS);
    },
  });

  const markdownNow = useCallback(
    () => editor?.storage?.markdown?.getMarkdown?.() ?? editor?.getText() ?? "",
    [editor]
  );

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearSaveTimer();
    if (!editor || !currentPath.current || !dirty.current || conflictRef.current) {
      return !conflictRef.current;
    }
    if (saveInFlight.current) {
      const previousSucceeded = await saveInFlight.current;
      if (!dirty.current || conflictRef.current) return !conflictRef.current;
      if (!previousSucceeded) return false;
      return saveNowRef.current();
    }

    const path = currentPath.current;
    const markdown = markdownNow();
    const expectedVersion = version.current;
    const operation = (async () => {
      try {
        const saved = await api.writeNote(path, markdown, expectedVersion);
        if (currentPath.current === path) {
          version.current = saved.version;
          if (markdownNow() === markdown) {
            dirty.current = false;
          }
          setSaveError(null);
          onNoteUpdated?.(saved);
        }
        onDirtySaved?.();
        return true;
      } catch (error) {
        if (currentPath.current !== path) return false;
        const message = String(error);
        if (message.toLowerCase().includes("conflict")) {
          try {
            const remote = await api.readNote(path);
            const nextConflict = { remote, localMarkdown: markdown };
            conflictRef.current = nextConflict;
            setConflict(nextConflict);
            setSaveError(null);
          } catch (readError) {
            setSaveError(`Save conflict; reloading the disk copy failed: ${String(readError)}`);
          }
        } else {
          setSaveError(`Autosave failed: ${message}`);
        }
        return false;
      }
    })();
    saveInFlight.current = operation;
    try {
      return await operation;
    } finally {
      if (saveInFlight.current === operation) saveInFlight.current = null;
    }
  }, [clearSaveTimer, editor, markdownNow, onDirtySaved, onNoteUpdated]);

  saveNowRef.current = saveNow;
  useImperativeHandle(ref, () => ({ flushSave: saveNow }), [saveNow]);

  // Insert an uploaded image at the cursor and persist to assets/.
  async function saveAndInsert(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setSaveError("Images must be 10 MB or smaller.");
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const relPath = await api.saveImage(file.name, Array.from(buf));
      editor?.chain().focus().setImage({ src: relPath, alt: file.name }).run();
    } catch (error) {
      setSaveError(`Image import failed: ${String(error)}`);
    }
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

  const loadNote = useCallback(
    (next: Note | null) => {
      if (!editor) return;
      clearSaveTimer();
      currentPath.current = next?.path ?? null;
      version.current = next?.version ?? "";
      dirty.current = false;
      conflictRef.current = null;
      setConflict(null);
      setSaveError(null);
      try {
        editor.commands.setContent(next?.markdown ?? "", false);
      } catch (error) {
        console.error("setContent failed, falling back to plain text:", error);
        editor.commands.setContent(
          {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: next?.markdown ? [{ type: "text", text: next.markdown }] : [],
              },
            ],
          },
          false
        );
      }
    },
    [clearSaveTimer, editor]
  );

  // Parent navigation flushes first. This fallback still captures pending text
  // before a direct prop transition initiated elsewhere.
  useEffect(() => {
    if (!editor) return;
    if (currentPath.current && currentPath.current !== note?.path && dirty.current) {
      void saveNowRef.current();
    }
    loadNote(note);
  }, [editor, loadNote, note?.path]);

  // Reload clean notes changed by another editor. Dirty notes become an
  // explicit conflict instead of being overwritten.
  useEffect(() => {
    return onVaultChanged((changedPath) => {
      const activePath = currentPath.current;
      if (!activePath || changedPath.replace(/\\/g, "/") !== activePath) return;
      void (async () => {
        if (saveInFlight.current) await saveInFlight.current;
        if (currentPath.current !== activePath) return;
        try {
          const remote = await api.readNote(activePath);
          if (remote.version === version.current) return;
          if (dirty.current) {
            const nextConflict = { remote, localMarkdown: markdownNow() };
            conflictRef.current = nextConflict;
            setConflict(nextConflict);
            clearSaveTimer();
          } else {
            loadNote(remote);
            onNoteUpdated?.(remote);
          }
        } catch (error) {
          setSaveError(`Couldn't reload an external change: ${String(error)}`);
        }
      })();
    });
  }, [clearSaveTimer, loadNote, markdownNow, onNoteUpdated]);

  useEffect(() => {
    const flush = () => void saveNowRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  // Open the page picker when the "/Link to page" command fires.
  useEffect(() => {
    const open = () => setLinkPickerOpen(true);
    const openPage = (event: Event) => {
      const href = (event as CustomEvent).detail as string;
      if (href) onOpenLink?.(decodeURIComponent(href));
    };
    window.addEventListener("rockion:link-page", open);
    window.addEventListener("rockion:open-page", openPage);
    return () => {
      window.removeEventListener("rockion:link-page", open);
      window.removeEventListener("rockion:open-page", openPage);
    };
  }, [onOpenLink]);

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

  function handleWrapClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!editor) return;
    const anchor = (event.target as HTMLElement)?.closest?.("a");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        event.preventDefault();
        api.openExternal(href);
      } else if (href && !/^(tel:|#)/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        event.preventDefault();
        onOpenLink?.(decodeURIComponent(href));
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        event.preventDefault();
      }
      return;
    }
    if (event.target !== event.currentTarget) return;
    const pmRect = editor.view.dom.getBoundingClientRect();
    if (event.clientY < pmRect.bottom) return;
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

  async function reloadDiskVersion() {
    if (!conflict) return;
    loadNote(conflict.remote);
    onNoteUpdated?.(conflict.remote);
  }

  async function keepLocalVersion() {
    if (!conflict || !currentPath.current) return;
    try {
      const saved = await api.writeNote(
        currentPath.current,
        conflict.localMarkdown,
        conflict.remote.version
      );
      editor?.commands.setContent(conflict.localMarkdown, false);
      version.current = saved.version;
      dirty.current = false;
      conflictRef.current = null;
      setConflict(null);
      setSaveError(null);
      onNoteUpdated?.(saved);
      onDirtySaved?.();
    } catch (error) {
      if (String(error).toLowerCase().includes("conflict")) {
        try {
          const remote = await api.readNote(currentPath.current);
          const nextConflict = { remote, localMarkdown: conflict.localMarkdown };
          conflictRef.current = nextConflict;
          setConflict(nextConflict);
        } catch {
          // Keep the current conflict visible if the disk copy cannot be reloaded.
        }
      }
      setSaveError(`Couldn't resolve the conflict: ${String(error)}`);
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
      <div className="page-header">
        <button
          className="page-icon"
          title="Change page icon"
          onClick={() => setIconPickerOpen((open) => !open)}
        >
          {note.icon && note.icon.startsWith("data:") ? (
            <img className="page-icon-img" src={note.icon} alt="" />
          ) : (
            note.icon || "📄"
          )}
        </button>
        {iconPickerOpen && (
          <EmojiPicker
            onClose={() => setIconPickerOpen(false)}
            onPick={(emoji) => {
              setIconPickerOpen(false);
              onSetIcon?.(note.path, emoji);
            }}
          />
        )}
      </div>
      {saveError && <div className="save-error">{saveError}</div>}
      <div className="editor-wrap" onClick={handleWrapClick}>
        <EditorContent editor={editor} />
      </div>
      <PagePicker
        open={linkPickerOpen}
        pages={pages ?? []}
        onPick={insertPageLink}
        onClose={() => setLinkPickerOpen(false)}
      />
      {conflict && (
        <div className="conflict-overlay" role="dialog" aria-modal="true">
          <div className="conflict-dialog">
            <h2>This note changed on disk</h2>
            <p>
              Rockion stopped autosaving so neither version is overwritten. Reload the disk
              version or intentionally replace it with your current editor text.
            </p>
            <div className="conflict-actions">
              <button onClick={reloadDiskVersion}>Reload disk version</button>
              <button className="primary" onClick={keepLocalVersion}>
                Keep my version
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default Editor;
