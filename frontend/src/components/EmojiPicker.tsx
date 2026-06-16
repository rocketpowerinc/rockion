import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { api } from "../api";
import { searchEmojis } from "../editor/emojiCatalog.mjs";

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
  assetName?: string;
}

// Emoji picker + custom image upload for setting a page icon.
export default function EmojiPicker({ onPick, onClose, assetName = "icon" }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Position with fixed coordinates so no scrolling ancestor (e.g. the dashboard)
  // can clip the popover and hide the upload/remove footer. Anchored to the icon
  // that opened it (the element right before the picker in the DOM).
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const matches = useMemo(() => searchEmojis(query), [query]);

  useLayoutEffect(() => {
    const width = popoverRef.current?.offsetWidth || 330;
    const anchor = overlayRef.current?.previousElementSibling as HTMLElement | null;
    const rect = anchor?.getBoundingClientRect();
    let left = 56;
    let top = 110;
    if (rect && rect.width > 0) {
      left = rect.left;
      top = rect.bottom + 6;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, top);
    const maxHeight = Math.max(220, window.innerHeight - top - 12);
    setStyle({ position: "fixed", top, left, maxHeight, visibility: "visible" });
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      onPick(await api.saveImage(assetName, Array.from(data)));
    } catch (err) {
      console.error("icon upload failed:", err);
    }
  }

  return (
    <>
      <div className="emoji-overlay" ref={overlayRef} onClick={onClose} />
      <div
        className="emoji-popover"
        ref={popoverRef}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="emoji-search"
          type="search"
          placeholder="Search icons, e.g. house"
          aria-label="Search page icons"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && matches.length > 0) {
              onPick(matches[0][0]);
            }
          }}
        />
        <div className="emoji-grid">
          {matches.map(([emoji, keywords]) => (
            <button
              key={emoji}
              className="emoji-cell"
              title={keywords.split(" ").slice(0, 4).join(", ")}
              aria-label={`Use ${keywords.split(" ")[0]} icon`}
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="emoji-empty">No icons match “{query}”.</div>
          )}
        </div>
        <div className="emoji-actions">
          <button className="emoji-action" onClick={() => fileRef.current?.click()}>
            Upload image…
          </button>
          <button className="emoji-action" onClick={() => onPick("")}>
            Remove
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
    </>
  );
}
