import { useEffect, useRef, useState } from "react";

interface Props {
  onSubmit: (title: string) => void;
  onClose: () => void;
}

// In-app "new page" prompt. Replaces window.prompt, which returns null on macOS
// (Wails' WKWebView does not implement a text-input panel), so the native prompt
// silently failed to create pages there.
export default function NewPageModal({ onSubmit, onClose }: Props) {
  const [title, setTitle] = useState("Untitled");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    if (title.trim()) onSubmit(title);
  };

  return (
    <div className="switcher-overlay" onClick={onClose}>
      <div className="switcher new-page" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="switcher-input"
          placeholder="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="new-page-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
