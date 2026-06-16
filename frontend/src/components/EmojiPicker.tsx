import { useMemo, useRef, useState, type ChangeEvent } from "react";
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
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchEmojis(query), [query]);

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
      <div className="emoji-overlay" onClick={onClose} />
      <div className="emoji-popover" onClick={(e) => e.stopPropagation()}>
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
