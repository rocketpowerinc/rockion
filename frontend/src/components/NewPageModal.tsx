import { useEffect, useRef, useState } from "react";
import type { PageTemplate } from "../api";

interface Props {
  onSubmit: (title: string, template: string) => Promise<void>;
  onClose: () => void;
  itemName?: "page" | "project";
  templates?: PageTemplate[];
}

// In-app "new page" prompt. Replaces window.prompt, which returns null on macOS
// (Wails' WKWebView does not implement a text-input panel), so the native prompt
// silently failed to create pages there.
export default function NewPageModal({
  onSubmit,
  onClose,
  itemName = "page",
  templates = [],
}: Props) {
  const [title, setTitle] = useState(itemName === "project" ? "New Project" : "Untitled");
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      await onSubmit(title, template);
    } catch (reason) {
      setError(String(reason));
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
          placeholder={itemName === "project" ? "Project name" : "Page title"}
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
        {templates.length > 0 && (
          <label className="new-page-template">
            <span>Template</span>
            <select
              value={template}
              disabled={submitting}
              onChange={(event) => setTemplate(event.target.value)}
            >
              {templates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <div className="new-item-error">{error}</div>}
        <div className="new-page-actions">
          <button className="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Creating…" : `Create ${itemName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
