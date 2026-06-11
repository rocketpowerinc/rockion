import { useEffect, useState } from "react";
import { api, type SearchHit } from "../api";

interface Props {
  path: string | null;
  onOpen: (path: string) => void;
}

export default function Backlinks({ path, onOpen }: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!path) {
      setHits([]);
      return;
    }
    api
      .backlinks(path)
      .then((r) => setHits(Array.isArray(r) ? r : []))
      .catch(() => setHits([]));
  }, [path]);

  const items = Array.isArray(hits) ? hits : [];
  if (!path || items.length === 0) return null;

  return (
    <div className="backlinks">
      <div className="backlinks-head">Linked references ({items.length})</div>
      {items.map((h) => (
        <button key={h.path} className="backlink" onClick={() => onOpen(h.path)}>
          {h.title}
        </button>
      ))}
    </div>
  );
}
