import { useEffect, useMemo, useRef, useState } from "react";

export interface PageRef {
  path: string;
  title: string;
}

interface Props {
  open: boolean;
  pages: PageRef[];
  onPick: (page: PageRef) => void;
  onClose: () => void;
}

// Notion-style "link to page" picker: search vault notes and pick one.
export default function PagePicker({ open, pages, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Array.isArray(pages) ? pages : [];
    if (!q) return list.slice(0, 50);
    return list
      .filter((p) => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, pages]);

  if (!open) return null;

  const choose = (i: number) => {
    const page = results[i];
    if (page) onPick(page);
  };

  return (
    <div className="switcher-overlay" onClick={onClose}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="switcher-input"
          placeholder="Link to page…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(selected);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="switcher-results">
          {results.length === 0 && <div className="tree-empty">No matching pages.</div>}
          {results.map((p, i) => (
            <button
              key={p.path}
              className={`switcher-item ${i === selected ? "is-selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(i)}
            >
              <div className="switcher-title">{p.title}</div>
              <div className="switcher-path">{p.path}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
