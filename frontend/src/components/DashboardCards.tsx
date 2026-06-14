import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api, type PageCard } from "../api";
import { coverBackground } from "../editor/coverStyles.mjs";

type ViewKind = "gallery" | "list";

interface Props {
  cards: PageCard[];
  kind: ViewKind;
  manualOrder: boolean;
  onOpen: (path: string) => void;
  onDelete: (card: PageCard) => void;
  onReorder: (fromID: string, toID: string) => void;
  onNew: () => void;
}

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

function LazyCardCover({ card }: { card: PageCard }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState("");
  const [ready, setReady] = useState(false);
  const localImage = card.cover?.kind === "image";

  useEffect(() => {
    setThumbnail("");
    setReady(!localImage);
    if (!localImage) return;
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void api
        .coverThumbnailDataURL(card.path)
        .then((url) => {
          if (!cancelled) {
            setThumbnail(url);
            setReady(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setThumbnail("");
            setReady(true);
          }
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [card.path, card.cover?.kind, card.cover?.value, localImage]);

  return (
    <div
      ref={ref}
      className="db-card-cover"
      style={{
        background:
          coverBackground(ready ? card.cover : undefined, thumbnail) || "var(--hover)",
      }}
    />
  );
}

export default function DashboardCards({
  cards,
  kind,
  manualOrder,
  onOpen,
  onDelete,
  onReorder,
  onNew,
}: Props) {
  const dragID = useRef<string | null>(null);

  const onGridKeyDown = (event: ReactKeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    const grid = event.currentTarget as HTMLElement;
    const items = Array.from(grid.querySelectorAll<HTMLElement>("[data-card]"));
    const current = document.activeElement as HTMLElement;
    const index = items.indexOf(current);
    if (index < 0) {
      items[0]?.focus();
      event.preventDefault();
      return;
    }
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = items[index + delta];
    if (next) {
      next.focus();
      event.preventDefault();
    }
  };

  const openOnKey = (path: string) => (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen(path);
  };

  const handleDragStart = (id: string) => (event: DragEvent) => {
    if (!manualOrder) {
      event.preventDefault();
      return;
    }
    dragID.current = id;
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (id: string) => (event: DragEvent) => {
    if (!manualOrder) return;
    event.preventDefault();
    const from = dragID.current;
    dragID.current = null;
    if (from) onReorder(from, id);
  };

  const allowDrop = (event: DragEvent) => {
    if (manualOrder) event.preventDefault();
  };

  const deleteButton = (card: PageCard, row = false) => (
    <button
      type="button"
      className={`db-card-delete ${row ? "db-row-delete" : ""}`}
      title={`Delete ${card.title}`}
      aria-label={`Delete ${card.title}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDelete(card);
      }}
    >
      ⋯
    </button>
  );

  if (kind === "list") {
    return (
      <div className="db-list" onKeyDown={onGridKeyDown}>
        {cards.map((card) => (
          <div
            key={card.pageId}
            className="db-row"
            data-card
            tabIndex={0}
            draggable={manualOrder}
            onDragStart={handleDragStart(card.pageId)}
            onDragOver={allowDrop}
            onDrop={handleDrop(card.pageId)}
            onClick={() => onOpen(card.path)}
            onKeyDown={openOnKey(card.path)}
          >
            <CardIcon card={card} />
            <span className="db-row-title">{card.title}</span>
            <span className="db-row-meta">Created {formatDate(card.createdAt)}</span>
            <span className="db-row-meta">Edited {formatDate(card.modifiedAt)}</span>
            {deleteButton(card, true)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="db-gallery" onKeyDown={onGridKeyDown}>
      {cards.map((card) => (
        <div
          key={card.pageId}
          className="db-card"
          data-card
          tabIndex={0}
          draggable={manualOrder}
          onDragStart={handleDragStart(card.pageId)}
          onDragOver={allowDrop}
          onDrop={handleDrop(card.pageId)}
          onClick={() => onOpen(card.path)}
          onKeyDown={openOnKey(card.path)}
        >
          <LazyCardCover card={card} />
          {deleteButton(card)}
          <div className="db-card-body">
            <div className="db-card-head">
              <CardIcon card={card} />
              <span className="db-card-title">{card.title}</span>
            </div>
            <CardDates card={card} />
          </div>
        </div>
      ))}
      <button className="db-card db-card-new" onClick={onNew}>
        <span>+ New page</span>
      </button>
    </div>
  );
}
