import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchHit, type VaultSearchResults } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => void;
}

interface SearchRow extends SearchHit {
  kind: "title" | "content";
}

const emptyResults: VaultSearchResults = {
  titleMatches: [],
  contentMatches: [],
};

export default function VaultSearch({ open, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VaultSearchResults>(emptyResults);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<SearchRow[]>(
    () => [
      ...results.titleMatches.map((hit) => ({ ...hit, kind: "title" as const })),
      ...results.contentMatches.map((hit) => ({ ...hit, kind: "content" as const })),
    ],
    [results]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(emptyResults);
    setSelected(0);
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(emptyResults);
      setSelected(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      void api
        .searchVault(trimmed)
        .then((next) => {
          if (cancelled) return;
          setResults({
            titleMatches: Array.isArray(next?.titleMatches) ? next.titleMatches : [],
            contentMatches: Array.isArray(next?.contentMatches) ? next.contentMatches : [],
          });
          setSelected(0);
        })
        .catch(() => {
          if (!cancelled) setResults(emptyResults);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, open]);

  if (!open) return null;

  const choose = (index: number) => {
    const hit = rows[index];
    if (!hit) return;
    onOpen(hit.path);
    onClose();
  };

  return (
    <div className="switcher-overlay" onClick={onClose}>
      <div className="switcher vault-search" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="switcher-input"
          type="search"
          placeholder="Search vault..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) => Math.min(current + 1, rows.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(selected);
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="switcher-results">
          {query.trim() === "" ? (
            <div className="switcher-empty">Type a word to search this vault.</div>
          ) : loading ? (
            <div className="switcher-empty">Searching...</div>
          ) : rows.length === 0 ? (
            <div className="switcher-empty">No matches found.</div>
          ) : (
            <>
              {results.titleMatches.length > 0 && (
                <div className="vault-search-section-title">
                  Page titles ({results.titleMatches.length})
                </div>
              )}
              {rows.map((hit, index) => {
                const startsContent =
                  hit.kind === "content" &&
                  rows[index - 1]?.kind !== "content";
                return (
                  <div key={`${hit.kind}:${hit.path}`}>
                    {startsContent && (
                      <div className="vault-search-section-title">
                        Page content (top {results.contentMatches.length})
                      </div>
                    )}
                    <button
                      className={`switcher-item ${index === selected ? "is-selected" : ""}`}
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => choose(index)}
                    >
                      <div className="switcher-title">{hit.title}</div>
                      <div className="switcher-path">{hit.path}</div>
                      {hit.snippet && (
                        <div
                          className="switcher-snippet"
                          dangerouslySetInnerHTML={{ __html: hit.snippet }}
                        />
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
