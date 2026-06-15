import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  api,
  type DashboardView,
  type Note,
  type PageCard,
  type PageCover,
  type PageTemplate,
} from "../api";
import { coverBackground } from "../editor/coverStyles.mjs";
import { coverPositionFromDrag } from "../editor/coverPosition.mjs";
import {
  reorderedDashboardIDs,
  sortDashboardCards,
} from "../editor/dashboardModel.mjs";
import NewPageModal from "./NewPageModal";
import CoverPicker from "./CoverPicker";
import CoverRepositionControls from "./CoverRepositionControls";
import DashboardCards from "./DashboardCards";
import EmojiPicker from "./EmojiPicker";

interface Props {
  note: Note;
  onOpenPage: (path: string) => void;
  onError: (message: string | null) => void;
  onRefreshTree: () => void;
  onNoteUpdated: (note: Note) => void;
  onRenameProject: (dashboardPath: string, title: string) => Promise<Note>;
  onSetIcon: (path: string, icon: string) => void;
  refreshVersion: number;
}

type ViewKind = "gallery" | "list";

const VIEWS: { id: ViewKind; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "list", label: "List" },
];

export default function Dashboard({
  note,
  onOpenPage,
  onError,
  onRefreshTree,
  onNoteUpdated,
  onRenameProject,
  onSetIcon,
  refreshVersion,
}: Props) {
  const dashboardPath = note.path;
  const [cards, setCards] = useState<PageCard[]>([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [view, setView] = useState<DashboardView>({ view: "gallery" });
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [dashCoverURL, setDashCoverURL] = useState("");
  const [coverRepositioning, setCoverRepositioning] = useState(false);
  const [coverDraftPosition, setCoverDraftPosition] = useState(50);
  const [coverPositionSaving, setCoverPositionSaving] = useState(false);
  const [projectTitle, setProjectTitle] = useState(note.title);
  const [projectRenameSaving, setProjectRenameSaving] = useState(false);
  const coverDrag = useRef({
    pointerId: -1,
    startY: 0,
    startPosition: 50,
    height: 1,
  });

  useEffect(() => {
    setProjectTitle(note.title);
  }, [note.path, note.title]);

  // Resolve the dashboard page's own cover (color/gradient need no fetch).
  useEffect(() => {
    let cancelled = false;
    setCoverRepositioning(false);
    if (note.cover && note.cover.kind === "image") {
      void api
        .coverImageDataURL(note.path)
        .then((url) => {
          if (!cancelled) setDashCoverURL(url);
        })
        .catch(() => {
          if (!cancelled) setDashCoverURL("");
        });
    } else {
      setDashCoverURL("");
    }
    return () => {
      cancelled = true;
    };
  }, [note.path, note.cover]);

  const setCover = useCallback(
    async (cover: PageCover) => {
      try {
        const updated = await api.setNoteCover(note.path, cover);
        onNoteUpdated(updated);
      } catch (reason) {
        onError(`Couldn't update cover: ${String(reason)}`);
      }
    },
    [note.path, onNoteUpdated, onError]
  );

  const uploadCover = useCallback(
    async (file: File) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("Cover images must be 10 MB or smaller.");
      const data = new Uint8Array(await file.arrayBuffer());
      const asset = await api.saveImage(file.name, Array.from(data));
      await setCover({ kind: "image", value: asset, position: 50 });
    },
    [setCover]
  );

  const removeCover = useCallback(
    () => setCover({ kind: "", value: "", position: 50 }),
    [setCover]
  );

  const renameProject = useCallback(async () => {
    const desired = projectTitle.trim();
    if (!desired || desired === note.title || projectRenameSaving) {
      setProjectTitle(note.title);
      return;
    }
    setProjectRenameSaving(true);
    try {
      const renamed = await onRenameProject(note.path, desired);
      setProjectTitle(renamed.title);
      onError(null);
    } catch (reason) {
      setProjectTitle(note.title);
      onError(`Couldn't rename project: ${String(reason)}`);
    } finally {
      setProjectRenameSaving(false);
    }
  }, [
    note.path,
    note.title,
    onError,
    onRenameProject,
    projectRenameSaving,
    projectTitle,
  ]);

  const startCoverReposition = useCallback(() => {
    setCoverDraftPosition(note.cover?.position ?? 50);
    setCoverRepositioning(true);
  }, [note.cover?.position]);

  const cancelCoverReposition = useCallback(() => {
    setCoverRepositioning(false);
    setCoverDraftPosition(note.cover?.position ?? 50);
  }, [note.cover?.position]);

  const saveCoverPosition = useCallback(async () => {
    if (!note.cover || note.cover.kind !== "image") return;
    setCoverPositionSaving(true);
    try {
      await setCover({ ...note.cover, position: coverDraftPosition });
      setCoverRepositioning(false);
    } finally {
      setCoverPositionSaving(false);
    }
  }, [coverDraftPosition, note.cover, setCover]);

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

  const reload = useCallback(async () => {
    try {
      const [loadedCards, loadedView] = await Promise.all([
        api.listDashboardCards(dashboardPath),
        api.getDashboardView(dashboardPath),
      ]);
      setCards(Array.isArray(loadedCards) ? loadedCards : []);
      setView(loadedView && loadedView.view ? loadedView : { view: "gallery" });
      onError(null);
    } catch (reason) {
      onError(`Couldn't load dashboard: ${String(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [dashboardPath, onError]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload, note.version, refreshVersion]);

  const updateView = useCallback(
    async (patch: Partial<DashboardView>) => {
      const previous = view;
      const next = { ...view, ...patch };
      setView(next);
      try {
        await api.setDashboardView(dashboardPath, next);
      } catch (reason) {
        setView(previous);
        onError(`Couldn't save view: ${String(reason)}`);
      }
    },
    [view, dashboardPath, onError]
  );

  const visibleCards = useMemo(() => {
    return sortDashboardCards(cards, view) as PageCard[];
  }, [cards, view]);

  const createPage = useCallback(
    async (title: string, template: string) => {
      try {
        const created = template
          ? await api.createSubPageFromTemplate(dashboardPath, title, template)
          : await api.createSubPage(dashboardPath, title);
        setNewOpen(false);
        onRefreshTree();
        await reload();
        onOpenPage(created.path);
      } catch (reason) {
        onError(`Couldn't create page: ${String(reason)}`);
        throw reason;
      }
    },
    [dashboardPath, onOpenPage, onError, onRefreshTree, reload]
  );

  const openNewPage = useCallback(async () => {
    try {
      const available = await api.listPageTemplates();
      setTemplates(Array.isArray(available) ? available : []);
      setNewOpen(true);
      onError(null);
    } catch (reason) {
      onError(`Couldn't load page templates: ${String(reason)}`);
    }
  }, [onError]);

  const reorder = useCallback(
    async (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const ids = reorderedDashboardIDs(cards, fromId, toId) as string[];
      const byId = new Map(cards.map((c) => [c.pageId, c]));
      setCards(ids.map((id) => byId.get(id)).filter(Boolean) as PageCard[]);
      try {
        await api.reorderManagedPages(dashboardPath, ids);
      } catch (reason) {
        onError(`Couldn't reorder pages: ${String(reason)}`);
        await reload();
      }
    },
    [cards, dashboardPath, onError, reload]
  );

  const deletePage = useCallback(
    async (card: PageCard) => {
      if (
        !window.confirm(
          `Delete "${card.title}"? This removes the dashboard entry and its Markdown file.`
        )
      ) {
        return;
      }
      try {
        const href = `?rockion-page=${encodeURIComponent(card.pageId)}`;
        const updated = await api.deleteManagedPage(dashboardPath, href, "");
        setCards((current) => current.filter((item) => item.pageId !== card.pageId));
        onNoteUpdated(updated);
        onRefreshTree();
      } catch (reason) {
        onError(`Couldn't delete page: ${String(reason)}`);
        await reload();
      }
    },
    [dashboardPath, onError, onNoteUpdated, onRefreshTree, reload]
  );

  const kind = (view.view as ViewKind) || "gallery";

  const dashCoverBackground = coverBackground(note.cover, dashCoverURL);

  return (
    <div className="dashboard">
      {note.cover && dashCoverBackground && (
        <div
          className={`page-cover db-cover ${
            coverRepositioning ? "is-repositioning" : ""
          }`}
          style={{
            background: dashCoverBackground,
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
              <button type="button" onClick={() => void removeCover()}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      <div className={`db-content ${note.cover ? "has-cover" : ""}`}>
        <div className={`db-header ${note.cover ? "has-cover" : ""}`}>
          <div className="db-title">
            <button
              className="db-title-icon-btn"
              title="Change project icon"
              onClick={() => setIconPickerOpen((open) => !open)}
            >
              {note.icon && note.icon.startsWith("data:") ? (
                <img className="db-title-icon-img" src={note.icon} alt="" />
              ) : (
                <span className="db-title-icon">{note.icon || "📁"}</span>
              )}
            </button>
            {iconPickerOpen && (
              <EmojiPicker
                onClose={() => setIconPickerOpen(false)}
                onPick={(icon) => {
                  setIconPickerOpen(false);
                  onSetIcon(note.path, icon);
                }}
              />
            )}
            <input
              className="db-title-input"
              value={projectTitle}
              disabled={projectRenameSaving}
              aria-label="Project name"
              onChange={(event) => setProjectTitle(event.target.value)}
              onBlur={() => void renameProject()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setProjectTitle(note.title);
                  event.currentTarget.blur();
                }
              }}
            />
            {!note.cover && (
              <button className="db-add-cover" onClick={() => setCoverPickerOpen(true)}>
                Add cover
              </button>
            )}
          </div>

          <div className="db-toolbar">
            <div className="db-tabs">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={`db-tab ${kind === v.id ? "is-active" : ""}`}
                  onClick={() => void updateView({ view: v.id })}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="db-controls">
              <label className="db-control">
                Sort
                <select
                  value={view.sortBy || ""}
                  onChange={(e) => void updateView({ sortBy: e.target.value })}
                >
                  <option value="">Manual</option>
                  <option value="title">Title</option>
                  <option value="tag">Tag</option>
                  <option value="created">Created</option>
                  <option value="modified">Modified</option>
                </select>
              </label>
              {view.sortBy && (
                <button
                  className="db-dir"
                  title="Toggle sort direction"
                  onClick={() =>
                    void updateView({ sortDir: view.sortDir === "desc" ? "asc" : "desc" })
                  }
                >
                  {view.sortDir === "desc" ? "↓" : "↑"}
                </button>
              )}
              <button className="primary db-new" onClick={() => void openNewPage()}>
                + New page
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="db-empty">Loading…</div>
        ) : cards.length === 0 ? (
          <div className="db-empty">
            <p>No pages yet.</p>
            <button className="primary" onClick={() => void openNewPage()}>
              Create your first page
            </button>
          </div>
        ) : (
          <DashboardCards
            cards={visibleCards}
            kind={kind}
            manualOrder={!view.sortBy}
            onOpen={onOpenPage}
            onDelete={(card) => void deletePage(card)}
            onReorder={(fromID, toID) => void reorder(fromID, toID)}
            onNew={() => void openNewPage()}
          />
        )}
      </div>

      {newOpen && (
        <NewPageModal
          itemName="page"
          templates={templates}
          onSubmit={createPage}
          onClose={() => setNewOpen(false)}
        />
      )}
      {coverPickerOpen && (
        <CoverPicker
          hasCover={!!note.cover}
          onClose={() => setCoverPickerOpen(false)}
          onPick={setCover}
          onUpload={uploadCover}
          onRemove={removeCover}
        />
      )}
    </div>
  );
}
