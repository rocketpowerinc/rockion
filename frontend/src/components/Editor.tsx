import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { editorExtensions } from "../editor/extensions";
import {
  api,
  onVaultChanged,
  type Note,
  type PageCover,
  type PageSettings,
} from "../api";
import PagePicker, { type PageRef } from "./PagePicker";
import EmojiPicker from "./EmojiPicker";
import type { WritingLanguage } from "../writingLanguage";
import { refreshSpellcheck } from "../editor/Spellcheck";
import NewPageModal from "./NewPageModal";
import BlockMenu from "../editor/BlockMenu";
import {
  managedPageHref,
  relativePageHref,
  resolvePageHref,
} from "../editor/pagePaths.mjs";
import { setCurrentPagePath } from "../editor/pageIcons";
import CoverPicker from "./CoverPicker";
import CoverRepositionControls from "./CoverRepositionControls";
import { coverBackground } from "../editor/coverStyles.mjs";
import { coverPositionFromDrag } from "../editor/coverPosition.mjs";
import PageTag from "./PageTag";
import SelectionToolbar from "./SelectionToolbar";
import { isExternalHref } from "../editor/externalLinks.mjs";
import { imageIconURL, isImageIcon } from "../editor/imageIcons.mjs";

interface Props {
  note: Note | null;
  writingLanguage: WritingLanguage;
  pages?: PageRef[];
  onDirtySaved?: () => void;
  onPageCreated?: () => void;
  onOpenLink?: (path: string) => void;
  onSetIcon?: (path: string, icon: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (path: string) => Promise<void>;
  onNoteUpdated?: (note: Note) => void;
  onNoteRenamed?: (note: Note) => void;
}

export interface EditorHandle {
  flushSave: () => Promise<boolean>;
}

interface Conflict {
  remote: Note;
  localMarkdown: string;
}

const AUTOSAVE_MS = 600;
// A title-rename waits a bit longer than autosave so it fires once the title
// has settled, not on every keystroke.
const TITLE_SYNC_MS = 1200;

// The note's title is the first non-empty line, and only when it's an ATX H1
// ("# Title"). Anything else (frontmatter, a paragraph) yields no title, so the
// file is left alone.
function plainHeadingTitle(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<a\s+[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function firstHeadingTitle(markdown: string): string {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = line.match(/^#\s+(.+)$/);
    return m ? plainHeadingTitle(m[1]) : "";
  }
  return "";
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    note,
    writingLanguage,
    pages,
    onDirtySaved,
    onPageCreated,
    onOpenLink,
    onSetIcon,
    isFavorite = false,
    onToggleFavorite,
    onNoteUpdated,
    onNoteRenamed,
  },
  ref
) {
  const saveTimer = useRef<number | null>(null);
  const currentPath = useRef<string | null>(null);
  const version = useRef("");
  const dirty = useRef(false);
  const conflictRef = useRef<Conflict | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);
  const titleRef = useRef("");
  const renameTimer = useRef<number | null>(null);
  const renameInFlight = useRef<Promise<void> | null>(null);
  const syncTitleRef = useRef<() => Promise<void>>(async () => {});
  const onNoteRenamedRef = useRef(onNoteRenamed);
  const pageOptionsRef = useRef<HTMLDivElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  onNoteRenamedRef.current = onNoteRenamed;
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [subPagePromptOpen, setSubPagePromptOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverImageDataURL, setCoverImageDataURL] = useState("");
  const [coverRepositioning, setCoverRepositioning] = useState(false);
  const [coverDraftPosition, setCoverDraftPosition] = useState(50);
  const [coverPositionSaving, setCoverPositionSaving] = useState(false);
  const [pageOptionsOpen, setPageOptionsOpen] = useState(false);
  const [pageSettings, setPageSettingsState] = useState<PageSettings>({
    locked: false,
    fullWidth: false,
  });
  const [pageSettingsSaving, setPageSettingsSaving] = useState(false);
  const coverDrag = useRef({
    pointerId: -1,
    startY: 0,
    startPosition: 50,
    height: 1,
  });

  const clearSaveTimer = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const clearRenameTimer = useCallback(() => {
    if (renameTimer.current !== null) {
      window.clearTimeout(renameTimer.current);
      renameTimer.current = null;
    }
  }, []);

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    editorProps: {
      attributes: {
        class: "rk-prose",
        lang: writingLanguage,
        spellcheck: "false",
      },
      handlePaste: (_view, event) => handleMediaPaste(event),
      handleDrop: (_view, event) => handleMediaDrop(event),
    },
    onUpdate: () => {
      if (!currentPath.current || conflictRef.current) return;
      dirty.current = true;
      clearSaveTimer();
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void saveNowRef.current();
      }, AUTOSAVE_MS);
      if (renameTimer.current !== null) window.clearTimeout(renameTimer.current);
      renameTimer.current = window.setTimeout(() => {
        renameTimer.current = null;
        void syncTitleRef.current();
      }, TITLE_SYNC_MS);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("lang", writingLanguage);
    void refreshSpellcheck(editor, writingLanguage);
  }, [editor, writingLanguage]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!pageSettings.locked);
    editor.view.dom.toggleAttribute("data-locked", pageSettings.locked);
  }, [editor, pageSettings.locked]);

  useEffect(() => {
    let cancelled = false;
    setPageOptionsOpen(false);
    setPageSettingsState({ locked: false, fullWidth: false });
    if (!note?.path) return () => {};
    void api
      .getPageSettings(note.path)
      .then((settings) => {
        if (!cancelled) {
          setPageSettingsState({
            locked: !!settings?.locked,
            fullWidth: !!settings?.fullWidth,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSaveError(`Couldn't load page settings: ${String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [note?.path]);

  useEffect(() => {
    if (!pageOptionsOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!pageOptionsRef.current?.contains(event.target as Node)) {
        setPageOptionsOpen(false);
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPageOptionsOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [pageOptionsOpen]);

  useEffect(() => {
    let cancelled = false;
    setCoverImageDataURL("");
    setCoverRepositioning(false);
    if (!note || note.cover?.kind !== "image") return () => {};
    void api
      .coverImageDataURL(note.path)
      .then((dataURL) => {
        if (!cancelled) setCoverImageDataURL(dataURL);
      })
      .catch((error) => {
        if (!cancelled) setSaveError(`Couldn't load the page cover: ${String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [note?.cover?.kind, note?.cover?.value, note?.path]);

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
    // A title-rename is moving the file; wait so we save to the new path, not
    // the old (now-missing) one.
    if (renameInFlight.current) {
      await renameInFlight.current;
      if (!dirty.current || conflictRef.current) return !conflictRef.current;
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

  // Rename the file on disk so it matches the title (first H1). Saves first so
  // the move never loses pending text, then moves only when the title changed.
  const syncTitle = useCallback(async () => {
    clearRenameTimer();
    const path = currentPath.current;
    if (!editor || !path || conflictRef.current) return;
    const saved = await saveNowRef.current();
    if (!saved || currentPath.current !== path || conflictRef.current) return;
    const desired = firstHeadingTitle(markdownNow());
    if (!desired || desired === titleRef.current) return;
    const op = (async () => {
      try {
        const renamed = await api.renameToTitle(path, desired);
        if (currentPath.current !== path) return;
        titleRef.current = desired;
        version.current = renamed.version;
        if (renamed.path !== path) {
          currentPath.current = renamed.path;
        }
        onNoteRenamedRef.current?.(renamed);
      } catch (error) {
        setSaveError(`Couldn't rename the file to match the title: ${String(error)}`);
      }
    })();
    renameInFlight.current = op;
    try {
      await op;
    } finally {
      if (renameInFlight.current === op) renameInFlight.current = null;
    }
  }, [clearRenameTimer, editor, markdownNow]);
  syncTitleRef.current = syncTitle;

  const updatePageSettings = useCallback(
    async (patch: Partial<PageSettings>) => {
      if (!note || pageSettingsSaving) return;
      if (patch.locked && !(await saveNowRef.current())) {
        setSaveError("The page could not be locked because pending edits were not saved.");
        return;
      }
      const previous = pageSettings;
      const next = { ...pageSettings, ...patch };
      setPageSettingsState(next);
      setPageSettingsSaving(true);
      try {
        await api.setPageSettings(note.path, next);
        setSaveError(null);
      } catch (error) {
        setPageSettingsState(previous);
        setSaveError(`Couldn't update page settings: ${String(error)}`);
      } finally {
        setPageSettingsSaving(false);
      }
    },
    [note, pageSettings, pageSettingsSaving]
  );

  function currentPageAssetName(): string {
    const source =
      firstHeadingTitle(markdownNow()) ||
      note?.title ||
      currentPath.current?.split("/").pop()?.replace(/\.[^.]+$/, "") ||
      "page";
    const slug = source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return slug || "page";
  }

  // Insert uploaded media at the cursor and persist to Assets/Images or Assets/Videos.
  async function saveAndInsert(file: File) {
    if (file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4")) {
      await saveAndInsertVideo(file);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSaveError("Images must be 10 MB or smaller.");
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const relPath = await api.saveImage(currentPageAssetName(), Array.from(buf));
      editor?.chain().focus().setImage({ src: relPath, alt: file.name }).run();
    } catch (error) {
      setSaveError(`Image import failed: ${String(error)}`);
    }
  }

  async function saveAndInsertVideo(file: File) {
    if (!file.name.toLowerCase().endsWith(".mp4") && file.type !== "video/mp4") {
      setSaveError("Only .mp4 video uploads are supported.");
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const relPath = await api.saveVideo(`${currentPageAssetName()}.mp4`, Array.from(buf));
      editor?.chain().focus().setVideo({ src: relPath, title: file.name }).run();
      setSaveError(null);
    } catch (error) {
      setSaveError(`Video import failed: ${String(error)}`);
    }
  }

  async function setPageCover(cover: PageCover) {
    if (!note) return;
    const updated = await api.setNoteCover(note.path, cover);
    onNoteUpdated?.(updated);
    setSaveError(null);
  }

  async function uploadPageCover(file: File) {
    if (!note) return;
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Cover images must be 10 MB or smaller.");
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const asset = await api.saveImage(currentPageAssetName(), Array.from(data));
    await setPageCover({
      kind: "image",
      value: asset,
      position: 50,
    });
  }

  function startCoverReposition() {
    setCoverDraftPosition(note?.cover?.position ?? 50);
    setCoverRepositioning(true);
  }

  function cancelCoverReposition() {
    setCoverRepositioning(false);
    setCoverDraftPosition(note?.cover?.position ?? 50);
  }

  async function saveCoverPosition() {
    if (!note?.cover || note.cover.kind !== "image") return;
    setCoverPositionSaving(true);
    try {
      await setPageCover({ ...note.cover, position: coverDraftPosition });
      setCoverRepositioning(false);
    } catch (reason) {
      setSaveError(`Couldn't reposition the page cover: ${String(reason)}`);
    } finally {
      setCoverPositionSaving(false);
    }
  }

  function beginCoverDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !coverRepositioning ||
      (event.target as HTMLElement).closest(".cover-reposition-ui")
    ) {
      return;
    }
    event.preventDefault();
    coverDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPosition: coverDraftPosition,
      height: event.currentTarget.getBoundingClientRect().height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCoverDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!coverRepositioning || coverDrag.current.pointerId !== event.pointerId) return;
    setCoverDraftPosition(
      coverPositionFromDrag(
        coverDrag.current.startPosition,
        event.clientY - coverDrag.current.startY,
        coverDrag.current.height
      )
    );
  }

  function endCoverDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (coverDrag.current.pointerId !== event.pointerId) return;
    coverDrag.current.pointerId = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleMediaPaste(event: ClipboardEvent): boolean {
    const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
      i.type.startsWith("image/") || i.type === "video/mp4"
    );
    if (!item) return false;
    const file = item.getAsFile();
    if (file) void saveAndInsert(file);
    return true;
  }

  function handleMediaDrop(event: DragEvent): boolean {
    const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
      f.type.startsWith("image/") || f.type === "video/mp4" || f.name.toLowerCase().endsWith(".mp4")
    );
    if (!file) return false;
    event.preventDefault();
    void saveAndInsert(file);
    return true;
  }

  const loadNote = useCallback(
    (next: Note | null) => {
      if (!editor) return;
      // Same note already loaded at the same version (e.g. our own title-rename
      // just changed its path): don't reset the editor, which would drop the
      // cursor/selection while the user is still typing the title.
      if (next && next.path === currentPath.current && next.version === version.current) {
        return;
      }
      clearSaveTimer();
      clearRenameTimer();
      currentPath.current = next?.path ?? null;
      setCurrentPagePath(next?.path ?? "");
      version.current = next?.version ?? "";
      // Seed with the note's current title so opening a note never triggers a
      // rename; only an actual title edit does.
      titleRef.current = firstHeadingTitle(next?.markdown ?? "");
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
    [clearRenameTimer, clearSaveTimer, editor]
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
      clearRenameTimer();
      flush();
    };
  }, [clearRenameTimer]);

  // Open page creation and linking dialogs from slash commands.
  useEffect(() => {
    const open = () => setLinkPickerOpen(true);
    const uploadVideo = () => videoInputRef.current?.click();
    const createSubPage = () => setSubPagePromptOpen(true);
    const deleteManagedPage = (event: Event) => {
      const href = (event as CustomEvent).detail as string;
      if (!href || !currentPath.current) return;
      void (async () => {
        if (
          !window.confirm(
            "Delete this page? This removes both the dashboard link and its Markdown file."
          )
        ) {
          return;
        }
        if (!(await saveNowRef.current()) || !currentPath.current) return;
        try {
          const updated = await api.deleteManagedPage(
            currentPath.current,
            href,
            version.current
          );
          loadNote(updated);
          onNoteUpdated?.(updated);
          onPageCreated?.();
        } catch (error) {
          setSaveError(`Couldn't delete managed page: ${String(error)}`);
        }
      })();
    };
    const openPage = (event: Event) => {
      const href = (event as CustomEvent).detail as string;
      const resolved = resolvePageHref(currentPath.current || "", href);
      if (resolved) onOpenLink?.(resolved);
    };
    const videoAssetAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as { action?: string; src?: string };
      if (!detail?.src) return;
      if (detail.action === "open") {
        void api.openAssetInFolder(detail.src).catch((error) =>
          setSaveError(`Couldn't open asset folder: ${String(error)}`)
        );
        return;
      }
      if (detail.action === "delete") {
        if (!window.confirm("Delete this video asset and remove it from the page?")) return;
        void (async () => {
          try {
            await api.deleteAsset(detail.src || "");
            removeVideoAsset(detail.src || "");
            setSaveError(null);
          } catch (error) {
            setSaveError(`Couldn't delete video asset: ${String(error)}`);
          }
        })();
      }
    };
    window.addEventListener("rockion:link-page", open);
    window.addEventListener("rockion:upload-video", uploadVideo);
    window.addEventListener("rockion:new-sub-page", createSubPage);
    window.addEventListener("rockion:delete-managed-page", deleteManagedPage);
    window.addEventListener("rockion:open-page", openPage);
    window.addEventListener("rockion:video-asset-action", videoAssetAction);
    return () => {
      window.removeEventListener("rockion:link-page", open);
      window.removeEventListener("rockion:upload-video", uploadVideo);
      window.removeEventListener("rockion:new-sub-page", createSubPage);
      window.removeEventListener("rockion:delete-managed-page", deleteManagedPage);
      window.removeEventListener("rockion:open-page", openPage);
      window.removeEventListener("rockion:video-asset-action", videoAssetAction);
    };
  }, [loadNote, onNoteUpdated, onOpenLink, onPageCreated]);

  function removeVideoAsset(src: string) {
    if (!editor) return;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "videoAsset" && node.attrs.src === src) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (from >= 0) {
      editor.view.dispatch(editor.state.tr.delete(from, to));
      dirty.current = true;
      void saveNowRef.current();
    }
  }

  function insertPageLink(page: PageRef) {
    setLinkPickerOpen(false);
    if (!editor) return;
    const href = relativePageHref(currentPath.current || "", page.path);
    editor
      .chain()
      .focus()
      .insertContent([
        { type: "text", text: page.title, marks: [{ type: "link", attrs: { href } }] },
        { type: "text", text: " " },
      ])
      .run();
  }

  async function createSubPage(title: string) {
    const sourcePath = currentPath.current;
    if (!sourcePath || !editor) return;
    try {
      const created = await api.createSubPage(sourcePath, title.trim());
      setSubPagePromptOpen(false);
      const href = managedPageHref(
        sourcePath,
        created.path,
        created.pageId,
        created.title
      );
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "text",
            text: created.title,
            marks: [{ type: "link", attrs: { href } }],
          },
          { type: "text", text: " " },
        ])
        .run();
      setSaveError(null);
      onPageCreated?.();
    } catch (error) {
      setSaveError(`Couldn't create sub-page: ${String(error)}`);
    }
  }

  function handleWrapClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!editor) return;
    const anchor = (event.target as HTMLElement)?.closest?.("a");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (isExternalHref(href)) {
        event.preventDefault();
        api.openExternal(href);
      } else if (href && !/^(tel:|#)/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        event.preventDefault();
        const resolved = resolvePageHref(currentPath.current || "", href);
        if (resolved) onOpenLink?.(resolved);
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

  const pageCoverBackground = coverBackground(note.cover, coverImageDataURL);

  return (
    <>
      {note.cover && pageCoverBackground && (
        <div
          className={`page-cover ${coverRepositioning ? "is-repositioning" : ""}`}
          style={{
            background: pageCoverBackground,
            backgroundPosition: `center ${
              coverRepositioning ? coverDraftPosition : note.cover.position ?? 50
            }%`,
          }}
          onPointerDown={beginCoverDrag}
          onPointerMove={moveCoverDrag}
          onPointerUp={endCoverDrag}
          onPointerCancel={endCoverDrag}
        >
          {coverRepositioning ? (
            <CoverRepositionControls
              saving={coverPositionSaving}
              onSave={() => void saveCoverPosition()}
              onCancel={cancelCoverReposition}
            />
          ) : (
            <div className="page-cover-actions">
              <button type="button" onClick={() => setCoverPickerOpen(true)}>
                Change cover
              </button>
              {note.cover.kind === "image" && (
                <button type="button" onClick={startCoverReposition}>
                  Reposition
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void setPageCover({ kind: "", value: "", position: 50 })
                }
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      <div
        className={`page-header ${note.cover ? "has-cover" : ""} ${
          pageSettings.fullWidth ? "is-full-width" : ""
        }`}
      >
        {!note.cover && (
          <button
            className="add-cover-button"
            onClick={() => setCoverPickerOpen(true)}
          >
            Add cover
          </button>
        )}
        {note.pageId && (
          <PageTag
            tag={note.tag}
            color={note.tagColor}
            className="page-header-tag"
          />
        )}
        <button
          className={`favorite-button ${isFavorite ? "is-favorite" : ""}`}
          title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          aria-label={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          aria-pressed={isFavorite}
          onClick={() => note && void onToggleFavorite?.(note.path)}
        >
          {isFavorite ? "★" : "☆"}
        </button>
        <div className="page-options" ref={pageOptionsRef}>
          <button
            className="page-options-button"
            title="Page options"
            aria-label="Page options"
            aria-haspopup="menu"
            aria-expanded={pageOptionsOpen}
            onClick={() => setPageOptionsOpen((open) => !open)}
          >
            ⋯
          </button>
          {pageOptionsOpen && (
            <div className="page-options-menu" role="menu">
              <button
                role="menuitemcheckbox"
                aria-checked={pageSettings.locked}
                disabled={pageSettingsSaving}
                onClick={() =>
                  void updatePageSettings({ locked: !pageSettings.locked })
                }
              >
                <span>{pageSettings.locked ? "Unlock page" : "Lock page"}</span>
                <span className={`menu-toggle ${pageSettings.locked ? "is-on" : ""}`} />
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={pageSettings.fullWidth}
                disabled={pageSettingsSaving}
                onClick={() =>
                  void updatePageSettings({ fullWidth: !pageSettings.fullWidth })
                }
              >
                <span>Full width</span>
                <span className={`menu-toggle ${pageSettings.fullWidth ? "is-on" : ""}`} />
              </button>
            </div>
          )}
        </div>
        <button
          className="page-icon"
          title="Change page icon"
          onClick={() => setIconPickerOpen((open) => !open)}
        >
          {isImageIcon(note.icon) ? (
            <img className="page-icon-img" src={imageIconURL(note.icon)} alt="" />
          ) : (
            note.icon || "📄"
          )}
        </button>
        {iconPickerOpen && (
          <EmojiPicker
            onClose={() => setIconPickerOpen(false)}
            assetName={currentPageAssetName()}
            onPick={(emoji) => {
              setIconPickerOpen(false);
              onSetIcon?.(note.path, emoji);
            }}
          />
        )}
      </div>
      {saveError && <div className="save-error">{saveError}</div>}
      <div
        className={`editor-wrap ${pageSettings.fullWidth ? "is-full-width" : ""} ${
          pageSettings.locked ? "is-locked" : ""
        }`}
        onClick={handleWrapClick}
      >
        <EditorContent editor={editor} />
      </div>
      <BlockMenu editor={editor} />
      <SelectionToolbar editor={editor} locked={pageSettings.locked} />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,.mp4"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) void saveAndInsertVideo(file);
        }}
      />
      <PagePicker
        open={linkPickerOpen}
        pages={pages ?? []}
        onPick={insertPageLink}
        onClose={() => setLinkPickerOpen(false)}
      />
      {subPagePromptOpen && (
        <NewPageModal
          onSubmit={createSubPage}
          onClose={() => setSubPagePromptOpen(false)}
        />
      )}
      {coverPickerOpen && (
        <CoverPicker
          hasCover={!!note.cover}
          onClose={() => setCoverPickerOpen(false)}
          onPick={setPageCover}
          onUpload={uploadPageCover}
          onRemove={() =>
            setPageCover({ kind: "", value: "", position: 50 })
          }
        />
      )}
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
