import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api, type DashboardView, type Note, type PageCard } from "../api";
import { coverBackground } from "../editor/coverStyles.mjs";
import NewPageModal from "./NewPageModal";

interface Props {
  note: Note;
  onOpenPage: (path: string) => void;
  onError: (message: string | null) => void;
  onRefreshTree: () => void;
  onOpenMarkdown: () => void;
}

const TEMPLATES: { id: string; label: string }[] = [
  { id: "", label: "Blank" },
  { id: "task", label: "Task" },
  { id: "meeting", label: "Meeting note" },
];

type ViewKind = "gallery" | "list" | "board" | "table";

const VIEWS: { id: ViewKind; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
];

const STATUS_DEFAULTS = ["To do", "In progress", "Done"];
const NO_VALUE = "—"; // em dash, label for the "no value" board column

function formatDate(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function Chip({ kind, value }: { kind: string; value: string }) {
  if (!value) return null;
  return <span className={`db-chip db-chip-${kind}`}>{value}</span>;
}

function CardChips({ card }: { card: PageCard }) {
  const props = card.properties || {};
  return (
    <div className="db-chips">
      {props.status && <Chip kind="status" value={props.status} />}
      {props.priority && <Chip kind="priority" value={props.priority} />}
      {props.date && <Chip kind="date" value={props.date} />}
      {props.tags &&
        props.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => <Chip key={t} kind="tag" value={t} />)}
    </div>
  );
}

function Progress({ card }: { card: PageCard }) {
  if (!card.todoTotal) return null;
  const pct = Math.round((card.todoDone / card.todoTotal) * 100);
  return (
    <div className="db-progress" title={`${card.todoDone}/${card.todoTotal} done`}>
      <div className="db-progress-bar" style={{ width: `${pct}%` }} />
      <span className="db-progress-label">
        {card.todoDone}/{card.todoTotal}
      </span>
    </div>
  );
}

function CardIcon({ card }: { card: PageCard }) {
  const icon = card.icon;
  if (icon && icon.startsWith("data:")) {
    return <img className="db-card-icon-img" src={icon} alt="" />;
  }
  return <span className="db-card-icon">{icon || "📄"}</span>;
}

export default function Dashboard({
  note,
  onOpenPage,
  onError,
  onRefreshTree,
  onOpenMarkdown,
}: Props) {
  const dashboardPath = note.path;
  const [cards, setCards] = useState<PageCard[]>([]);
  const [view, setView] = useState<DashboardView>({ view: "gallery" });
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [template, setTemplate] = useState("");
  const [coverImages, setCoverImages] = useState<Record<string, string>>({});
  const dragId = useRef<string | null>(null);

  // Project-wide checklist rollup across all cards.
  const rollup = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const c of cards) {
      done += c.todoDone;
      total += c.todoTotal;
    }
    return { done, total };
  }, [cards]);

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

  // Resolve data URLs for local-image covers (color/gradient need no fetch).
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
    let list = cards.slice();
    if (view.filterKey && view.filterValue) {
      const key = view.filterKey;
      const needle = view.filterValue.toLowerCase();
      list = list.filter((c) => (c.properties?.[key] || "").toLowerCase().includes(needle));
    }
    const sortBy = view.sortBy;
    if (sortBy) {
      list.sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortBy === "modified") {
          av = a.modifiedAt;
          bv = b.modifiedAt;
        } else if (sortBy === "title") {
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
        } else {
          av = (a.properties?.[sortBy] || "").toLowerCase();
          bv = (b.properties?.[sortBy] || "").toLowerCase();
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

  const setProperty = useCallback(
    async (path: string, key: string, value: string) => {
      setCards((cs) =>
        cs.map((c) => {
          if (c.path !== path) return c;
          const props = { ...(c.properties || {}) };
          if (value) props[key] = value;
          else delete props[key];
          return { ...c, properties: props };
        })
      );
      try {
        await api.setPageProperty(path, key, value);
      } catch (reason) {
        onError(`Couldn't update ${key}: ${String(reason)}`);
        await reload();
      }
    },
    [onError, reload]
  );

  const kind = (view.view as ViewKind) || "gallery";
  const groupKey = view.groupBy || "status";

  const boardColumns = useMemo(() => {
    const values: string[] = [];
    if (groupKey === "status") values.push(...STATUS_DEFAULTS);
    for (const c of visibleCards) {
      const v = c.properties?.[groupKey];
      if (v && !values.includes(v)) values.push(v);
    }
    values.push(NO_VALUE);
    return values.map((value) => ({
      value,
      cards: visibleCards.filter((c) => {
        const v = c.properties?.[groupKey] || "";
        return value === NO_VALUE ? !v : v === value;
      }),
    }));
  }, [visibleCards, groupKey]);

  const cardBackground = (card: PageCard): string =>
    coverBackground(card.cover, coverImages[card.pageId] || "");

  // --- drag handlers ---
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
  const handleDropOnColumn = (value: string) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragId.current;
    dragId.current = null;
    if (!from) return;
    const card = cards.find((c) => c.pageId === from);
    if (card) void setProperty(card.path, groupKey, value === NO_VALUE ? "" : value);
  };
  const allowDrop = (e: DragEvent) => e.preventDefault();

  return (
    <div className="dashboard">
      <div className="db-header">
        <div className="db-title">
          {note.icon && note.icon.startsWith("data:") ? (
            <img className="db-title-icon-img" src={note.icon} alt="" />
          ) : (
            <span className="db-title-icon">{note.icon || "📁"}</span>
          )}
          <h1>{note.title}</h1>
          {rollup.total > 0 && (
            <span className="db-rollup" title="Checklist items across all pages">
              {rollup.done}/{rollup.total} done
            </span>
          )}
          <button
            className="db-markdown-toggle"
            title="Edit this dashboard as markdown"
            onClick={onOpenMarkdown}
          >
            Open as markdown
          </button>
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
            {kind === "board" && (
              <label className="db-control">
                Group
                <select
                  value={groupKey}
                  onChange={(e) => void updateView({ groupBy: e.target.value })}
                >
                  <option value="status">Status</option>
                  <option value="priority">Priority</option>
                </select>
              </label>
            )}
            <label className="db-control">
              Sort
              <select
                value={view.sortBy || ""}
                onChange={(e) => void updateView({ sortBy: e.target.value })}
              >
                <option value="">Manual</option>
                <option value="title">Title</option>
                <option value="modified">Modified</option>
                <option value="status">Status</option>
                <option value="priority">Priority</option>
                <option value="date">Date</option>
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
              Filter
              <input
                className="db-filter"
                placeholder="status…"
                value={view.filterValue || ""}
                onChange={(e) =>
                  void updateView({
                    filterKey: view.filterKey || "status",
                    filterValue: e.target.value,
                  })
                }
              />
            </label>
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
      ) : kind === "gallery" ? (
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
                {card.excerpt && <p className="db-card-excerpt">{card.excerpt}</p>}
                <CardChips card={card} />
                <Progress card={card} />
                <div className="db-card-meta">{formatDate(card.modifiedAt)}</div>
              </div>
            </div>
          ))}
          <button className="db-card db-card-new" onClick={() => setNewOpen(true)}>
            <span>+ New page</span>
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
              <CardChips card={card} />
              <span className="db-row-meta">{formatDate(card.modifiedAt)}</span>
            </div>
          ))}
        </div>
      ) : kind === "table" ? (
        <div className="db-table-wrap">
          <table className="db-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Date</th>
                <th>Tags</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {visibleCards.map((card) => (
                <tr
                  key={card.pageId}
                  draggable
                  onDragStart={handleDragStart(card.pageId)}
                  onDragOver={allowDrop}
                  onDrop={handleDropOnCard(card.pageId)}
                  onClick={() => onOpenPage(card.path)}
                >
                  <td>
                    <CardIcon card={card} /> {card.title}
                  </td>
                  <td>{card.properties?.status || ""}</td>
                  <td>{card.properties?.priority || ""}</td>
                  <td>{card.properties?.date || ""}</td>
                  <td>{card.properties?.tags || ""}</td>
                  <td>{formatDate(card.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="db-board">
          {boardColumns.map((column) => (
            <div
              key={column.value}
              className="db-column"
              onDragOver={allowDrop}
              onDrop={handleDropOnColumn(column.value)}
            >
              <div className="db-column-head">
                {column.value} <span className="db-column-count">{column.cards.length}</span>
              </div>
              {column.cards.map((card) => (
                <div
                  key={card.pageId}
                  className="db-board-card"
                  draggable
                  onDragStart={handleDragStart(card.pageId)}
                  onClick={() => onOpenPage(card.path)}
                >
                  <div className="db-card-head">
                    <CardIcon card={card} />
                    <span className="db-card-title">{card.title}</span>
                  </div>
                  <CardChips card={card} />
                  <Progress card={card} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {newOpen && (
        <NewPageModal
          itemName="page"
          onSubmit={createPage}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}
