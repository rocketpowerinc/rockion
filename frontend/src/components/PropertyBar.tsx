import { useEffect, useState } from "react";
import type { Note } from "../api";

const STATUS = ["To do", "In progress", "Done"];
const PRIORITY = ["Low", "Medium", "High"];

function fmString(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

interface Props {
  note: Note;
  onSet: (key: string, value: string) => Promise<void> | void;
}

// A compact, editable property bar (status / priority / date / tags) shown above
// the page body. Values live in the note's YAML frontmatter; edits are written
// through onSet so the editor can keep its file version in sync.
export default function PropertyBar({ note, onSet }: Props) {
  const fm = note.frontmatter || {};
  const status = fmString(fm.status);
  const priority = fmString(fm.priority);
  const date = fmString(fm.date);
  const [tags, setTags] = useState(fmString(fm.tags));

  useEffect(() => {
    setTags(fmString((note.frontmatter || {}).tags));
  }, [note.path, note.version]); // resync when the note (re)loads

  const statusOptions = Array.from(new Set([...STATUS, status].filter(Boolean)));
  const priorityOptions = Array.from(new Set([...PRIORITY, priority].filter(Boolean)));

  return (
    <div className="prop-bar">
      <label className="prop">
        <span className="prop-key">Status</span>
        <select value={status} onChange={(e) => void onSet("status", e.target.value)}>
          <option value="">—</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="prop">
        <span className="prop-key">Priority</span>
        <select value={priority} onChange={(e) => void onSet("priority", e.target.value)}>
          <option value="">—</option>
          {priorityOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="prop">
        <span className="prop-key">Date</span>
        <input
          type="date"
          value={/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ""}
          onChange={(e) => void onSet("date", e.target.value)}
        />
      </label>
      <label className="prop prop-tags">
        <span className="prop-key">Tags</span>
        <input
          value={tags}
          placeholder="tag1, tag2"
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => void onSet("tags", tags)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onSet("tags", tags);
            }
          }}
        />
      </label>
    </div>
  );
}
