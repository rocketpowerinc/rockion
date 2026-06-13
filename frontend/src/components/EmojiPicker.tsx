import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { searchEmojis } from "../editor/emojiCatalog.mjs";

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

// Emoji picker + custom image upload for setting a page icon.
export default function EmojiPicker({ onPick, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchEmojis(query), [query]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      console.error("icon upload failed: image exceeds 5 MB");
      return;
    }
    try {
      onPick(await fileToIconDataUrl(file));
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

// Read an image file and produce a small (64px, cover-fit) PNG data URL.
function fileToIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        if (img.width <= 0 || img.height <= 0 || img.width > 4096 || img.height > 4096) {
          reject(new Error("icon dimensions are invalid or too large"));
          return;
        }
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no canvas context"));
          return;
        }
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
