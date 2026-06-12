import { useRef, type ChangeEvent } from "react";

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const EMOJIS = [
  "📄", "📝", "📔", "📓", "📚", "📒", "🗒️", "📋",
  "🗂️", "📁", "📌", "📍", "🔖", "🏷️", "✅", "⭐",
  "🌟", "💡", "🔥", "⚡", "🚀", "🎯", "🎨", "🛠️",
  "🔧", "⚙️", "🧩", "🔬", "🧪", "💻", "🖥️", "📱",
  "🌐", "🔒", "🔑", "📊", "📈", "💰", "🗓️", "⏰",
  "✏️", "📎", "🔗", "❗", "❓", "💬", "🏠", "🧠",
];

// Emoji picker + custom image upload for setting a page icon.
export default function EmojiPicker({ onPick, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

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
        <div className="emoji-grid">
          {EMOJIS.map((e) => (
            <button key={e} className="emoji-cell" onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
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
