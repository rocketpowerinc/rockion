import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

import { SlashCommand } from "./SlashCommand";

// The full set of TipTap extensions that make up the Rockion editor.
export const editorExtensions = [
  StarterKit.configure({
    // We use the dedicated HorizontalRule from StarterKit; nothing to disable.
  }),
  Placeholder.configure({
    placeholder: "Type '/' for commands…",
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Image.configure({ inline: false, allowBase64: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  // Round-trips the document to/from GitHub-Flavored Markdown on disk.
  Markdown.configure({
    html: false,
    tightLists: true,
    bulletListMarker: "-",
    linkify: true,
    breaks: false,
    transformPastedText: true,
  }),
  SlashCommand,
];
