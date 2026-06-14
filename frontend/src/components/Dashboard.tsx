import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api, type DashboardView, type Note, type PageCard, type PageCover } from "../api";
import { coverBackground } from "../editor/coverStyles.mjs";
import NewPageModal from "./NewPageModal";
import CoverPicker from "./CoverPicker";
import EmojiPicker from "./EmojiPicker";

interface Props {
  note: Note;
  onOpenPage: (path: string) => void;
  onError: (message: string | null) => void;
  onRefreshTree: () => void;
  onNoteUpdated: (note: Note) => void;
  onSetIcon: (path: string, icon: string) => void;
}

const TEMPLATES: { id: string; label: string }[] = [
  { id: "", label: "Blank" },
  { id: "task", label: "Task" },
  { id: "meeting", label: "Meeting note" },
];

type ViewKind = "gallery" | "list";

const VIEWS: { id: ViewKind; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "list", label: "List" },
];

function formatDate(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function CardIcon({ card }: { card: PageCard }) {
  const icon = card.icon;
  if (icon && icon.startsWith("data:")) {
    return <img className="db-card-icon-img" src={icon} alt="" />;
  }
  return <span className="db-card-icon">{icon || "📄"}</span>;
}

function CardDates({ card }: { card: PageCard }) {
  return (
    <div className="db-card-meta">
      <span>Created {formatDate(card.createdAt)}</span>
      <span>Edited {formatDate(card.modifiedAt)}</span>
    </div>
  );
}

export default function Dashboard({
  note,
  onOpenPage,
  onError,
  onRefreshTree,
  onNoteUpdated,
  onSetIcon,
}: Props) {
  const dashboardPath = note.path;
  const [cards, setCards] = useState<PageCard[]>([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [view, setView] = useState<DashboardView>({ view: "gallery" });
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [template, setTemplate] = useState("");
  const [coverImages, setCoverImages] = useState<Record<string, string>>({});
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [dashCoverURL, setDashCoverURL] = useState("");
  const dragId = useRef<string | null>(null);

  // Resolve the dashboard page's own cover (color/gradient need no fetch).
  useEffect(() => {
    let cancelled = false;
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

  // Move focus between cards with arrow keys.
  const onGridKeyDown = (ev: ReactKeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(ev.key)) return;
    const grid = ev.currentTarget as HTMLElement;
    const items = Array.from(grid.querySelectorAll<HTMLElement>("[data-card]"));
    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);
    if (idx < 0) {
      items[0]?.focus();
      ev.preventDefault();
      return;
    }
    const delta = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : -1;
    const next = items[idx + delta];
    if (next) {
      next.focus();
      ev.preventDefault();
    }
  };

  const openOnEnter = (path: string) => (ev: ReactKeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onOpenPage(path);
    }
  };

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
  }, [reload, note.version]);

  // Resolve data URLs for local-image card covers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const card of cards) {
        if (card.cover && card.cover.kind === "image") {
          try {
            next[card.pageId] = await api.coverImageDataURL(card.path);
          } catch {
            /* leave blank */
          }
        }
      }
      if (!cancelled) setCoverImages(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [cards]);

  const updateView = useCallback(
    async (patch: Partial<DashboardView>) => {
      const next = { ...view, ...patch };
      setView(next);
      try {
        await api.setDashboardView(dashboardPath, next);
      } catch (reason) {
        onError(`Couldn't save view: ${String(reason)}`);
      }
    },
    [view, dashboardPath, onError]
  );

  const visibleCards = useMemo(() => {
    const list = cards.slice();
    const sortBy = view.sortBy;
    if (sortBy) {
      list.sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortBy === "modified") {
          av = a.modifiedAt;
          bv = b.modifiedAt;
        } else if (sortBy === "created") {
          av = a.createdAt;
          bv = b.createdAt;
        } else {
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
        }
        if (av < bv) return view.sortDir === "desc" ? 1 : -1;
        if (av > bv) return view.sortDir === "desc" ? -1 : 1;
        return 0;
      });
    }
    return list;
  }, [cards, view]);

  const createPage = useCallback(
    async (title: string) => {
      try {
        const created = await api.createSubPageFromTemplate(dashboardPath, title, template);
        setNewOpen(false);
        onRefreshTree();
        await reload();
        onOpenPage(created.path);
      } catch (reason) {
        onError(`Couldn't create page: ${String(reason)}`);
        throw reason;
      }
    },
    [dashboardPath, template, onOpenPage, onError, onRefreshTree, reload]
  );

  const reorder = useCallback(
    async (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const ids = cards.map((c) => c.pageId);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
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

  const kind = (view.view as ViewKind) || "gallery";

  const cardBackground = (card: PageCard): string =>
    coverBackground(card.cover, coverImages[card.pageId] || "");

  // --- drag handlers (reorder only) ---
  const handleDragStart = (id: string) => (e: DragEvent) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDropOnCard = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragId.current;
    dragId.current = null;
    if (from) void reorder(from, id);
  };
  const allowDrop = (e: DragEvent) => e.preventDefault();

  const dashCoverBackground = coverBackground(note.cover, dashCoverURL);

  return (
    <div className="dashboard">
      {note.cover && dashCoverBackground && (
        <div
          className="page-cover db-cover"
          style={{
            background: dashCoverBackground,
            backgroundPosition: `center ${note.cover.position ?? 50}%`,
          }}
        >
          <div className="page-cover-actions">
            <button type="button" onClick={() => setCoverPickerOpen(true)}>
              Change cover
            </button>
            <button type="button" onClick={() => void removeCover()}>
              Remove
            </button>
          </div>
        </div>
      )}
      <div className="db-content">
        <div className="db-header">
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
            <h1>{note.title}</h1>
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
              <label className="db-control">
                Template
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary db-new" onClick={() => setNewOpen(true)}>
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
            <button className="primary" onClick={() => setNewOpen(true)}>
              Create your first page
            </button>
          </div>
        ) : kind === "list" ? (
          <div className="db-list" onKeyDown={onGridKeyDown}>
            {visibleCards.map((card) => (
              <div
                key={card.pageId}
                className="db-row"
                data-card
                tabIndex={0}
                draggable
                onDragStart={handleDragStart(card.pageId)}
                onDragOver={allowDrop}
                onDrop={handleDropOnCard(card.pageId)}
                onClick={() => onOpenPage(card.path)}
                onKeyDown={openOnEnter(card.path)}
              >
                <CardIcon card={card} />
                <span className="db-row-title">{card.title}</span>
                <span className="db-row-meta">Created {formatDate(card.createdAt)}</span>
                <span className="db-row-meta">Edited {formatDate(card.modifiedAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="db-gallery" onKeyDown={onGridKeyDown}>
            {visibleCards.map((card) => (
              <div
                key={card.pageId}
                className="db-card"
                data-card
                tabIndex={0}
                draggable
                onDragStart={handleDragStart(card.pageId)}
                onDragOver={allowDrop}
                onDrop={handleDropOnCard(card.pageId)}
                onClick={() => onOpenPage(card.path)}
                onKeyDown={openOnEnter(card.path)}
              >
                <div
                  className="db-card-cover"
                  style={{ background: cardBackground(card) || "var(--hover)" }}
                />
                <div className="db-card-body">
                  <div className="db-card-head">
                    <CardIcon card={card} />
                    <span className="db-card-title">{card.title}</span>
                  </div>
                  <CardDates card={card} />
                </div>
              </div>
            ))}
            <button className="db-card db-card-new" onClick={() => setNewOpen(true)}>
              <span>+ New page</span>
            </button>
          </div>
        )}
      </div>

      {newOpen && (
        <NewPageModal itemName="page" onSubmit={createPage} onClose={() => setNewOpen(false)} />
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
