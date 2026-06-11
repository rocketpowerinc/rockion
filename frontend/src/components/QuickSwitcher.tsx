import { useEffect, useRef, useState } from "react";
import { api, type SearchHit } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => void;
}

// Cmd/Ctrl+P fuzzy file + full-text switcher.
export default function QuickSwitcher({ open, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      api
        .search(query, 20)
        .then((r) => {
          setHits(Array.isArray(r) ? r : []);
          setSelected(0);
        })
        .catch(() => setHits([]));
    }, 80);
    return () => clearTimeout(handle);
  }, [query, open]);

  if (!open) return null;

  const choose = (i: number) => {
    const hit = hits[i];
    if (hit) {
      onOpen(hit.path);
      onClose();
    }
  };

  return (
    <div className="switcher-overlay" onClick={onClose}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="switcher-input"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
            else if (e.key === "Enter") choose(selected);
            else if (e.key === "Escape") onClose();
          }}
        />
        <div className="switcher-results">
          {hits.map((h, i) => (
            <button
              key={h.path}
              className={`switcher-item ${i === selected ? "is-selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(i)}
            >
              <div className="switcher-title">{h.title}</div>
              <div className="switcher-path">{h.path}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
