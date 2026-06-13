import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import DragHandle from "tiptap-extension-global-drag-handle";

import { SlashCommand } from "./SlashCommand";
import { Callout } from "./Callout";
import { CodeBlock } from "./CodeBlock";
import { AddBlockButton } from "./AddBlockButton";
import { PageLinkDecorations } from "./PageLinkDecorations";
import { SafeImage } from "./SafeImage";
import { Spellcheck } from "./Spellcheck";
import { AutoLink } from "./AutoLink";
import { LinkContextMenu } from "./LinkContextMenu";
import { MarkdownLinkCleanup } from "./MarkdownLinkCleanup";

// The full set of TipTap extensions that make up the Rockion editor.
export const editorExtensions = [
  StarterKit.configure({
    // Replaced by the syntax-highlighting CodeBlock below.
    codeBlock: false,
  }),
  Placeholder.configure({
    placeholder: "Type '/' for commands…",
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  CodeBlock,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  SafeImage,
  AutoLink,
  MarkdownLinkCleanup,
  // Round-trips the document to/from GitHub-Flavored Markdown on disk.
  Markdown.configure({
    html: false,
    tightLists: true,
    bulletListMarker: "-",
    linkify: false,
    breaks: false,
    transformPastedText: true,
  }),
  SlashCommand,
  // Notion-style per-block hover handle: grab any block to drag-reorder it.
  // Operates on the in-memory doc only — files stay plain Markdown on save.
  DragHandle.configure({
    dragHandleWidth: 22,
    scrollTreshold: 100,
    // Treat callouts as draggable blocks so a nested callout can be dragged out.
    customNodes: ["callout"],
  }),
  AddBlockButton,
  PageLinkDecorations,
  LinkContextMenu,
  Spellcheck,
];
