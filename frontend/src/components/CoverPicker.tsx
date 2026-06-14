import { useRef, useState } from "react";
import type { PageCover } from "../api";
import { coverColors, coverGradients } from "../editor/coverStyles.mjs";

interface Props {
  onClose: () => void;
  onPick: (cover: PageCover) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  hasCover: boolean;
}

export default function CoverPicker({
  onClose,
  onPick,
  onUpload,
  onRemove,
  hasCover,
}: Props) {
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cover-picker-overlay" onMouseDown={onClose}>
      <div
        className="cover-picker"
        role="dialog"
        aria-label="Choose page cover"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cover-picker-tabs">
          {(["gallery", "upload"] as const).map((name) => (
            <button
              key={name}
              className={tab === name ? "is-active" : ""}
              onClick={() => setTab(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>

        {tab === "gallery" && (
          <div className="cover-gallery">
            <p>Colors</p>
            <div className="cover-swatch-grid">
              {coverColors.map((color) => (
                <button
                  key={color}
                  aria-label={`Use cover color ${color}`}
                  style={{ background: color }}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      onPick({ kind: "color", value: color, position: 50 })
                    )
                  }
                />
              ))}
            </div>
            <p>Gradients</p>
            <div className="cover-swatch-grid">
              {Object.entries(coverGradients).map(([name, gradient]) => (
                <button
                  key={name}
                  aria-label={`Use ${name} gradient`}
                  style={{ background: gradient }}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      onPick({ kind: "gradient", value: name, position: 50 })
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <div className="cover-upload">
            <p>Choose a PNG, JPEG, or GIF up to 10 MB.</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void run(() => onUpload(file));
              }}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Choose an image
            </button>
          </div>
        )}

        {error && <div className="cover-picker-error">{error}</div>}
        {hasCover && (
          <button
            className="cover-remove"
            disabled={busy}
            onClick={() => void run(onRemove)}
          >
            Remove cover
          </button>
        )}
      </div>
    </div>
  );
}
