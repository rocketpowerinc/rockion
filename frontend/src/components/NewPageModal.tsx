import { useEffect, useRef, useState } from "react";

interface Props {
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}

// In-app "new page" prompt. Replaces window.prompt, which returns null on macOS
// (Wails' WKWebView does not implement a text-input panel), so the native prompt
// silently failed to create pages there.
export default function NewPageModal({ onSubmit, onClose }: Props) {
  const [title, setTitle] = useState("Untitled");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const submit = async () => {
    if (!title.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(title);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="switcher-overlay" onClick={() => !submitting && onClose()}>
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
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (!submitting) onClose();
            }
          }}
        />
        <div className="new-page-actions">
          <button className="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
