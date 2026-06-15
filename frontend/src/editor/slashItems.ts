import type { Editor, Range } from "@tiptap/core";
import { matchesSlashSearch } from "./slashSearch.mjs";

export interface SlashItem {
  title: string;
  hint: string;
  aliases?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

export const slashItems: SlashItem[] = [
  {
    title: "Heading 1",
    hint: "Big section heading",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    hint: "Medium heading",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    hint: "Small heading",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    hint: "Unordered list",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    hint: "Ordered list",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "To-do",
    hint: "Checklist item",
    aliases: ["todo", "to do", "task", "checkbox", "checklist"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Link to page",
    hint: "Insert a link to another note 🔗",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Editor.tsx listens for this and opens the page picker.
      window.dispatchEvent(new CustomEvent("rockion:link-page"));
    },
  },
  {
    title: "Table",
    hint: "3×3 table",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: "Quote",
    hint: "Block quote",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Callout",
    hint: "Click its icon to cycle green → red → yellow 🟢",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).wrapIn("callout", { type: "green" }).run(),
  },
  {
    title: "Code block",
    hint: "Fenced code",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    hint: "Horizontal rule",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  return slashItems.filter((item) => matchesSlashSearch(item, query)).slice(0, 10);
}
