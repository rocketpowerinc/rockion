import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface FindMatch {
  from: number;
  to: number;
  kind: "text" | "node";
}

interface PageFindState {
  query: string;
  index: number;
  matches: FindMatch[];
}

interface PageFindMeta {
  query?: string;
  index?: number;
  clear?: boolean;
}

const pageFindKey = new PluginKey<PageFindState>("rockionPageFind");

function emptyState(): PageFindState {
  return { query: "", index: 0, matches: [] };
}

function findMatches(doc: ProseMirrorNode, query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const haystack = node.text.toLowerCase();
      let offset = haystack.indexOf(needle);
      while (offset >= 0) {
        matches.push({
          from: pos + offset,
          to: pos + offset + needle.length,
          kind: "text",
        });
        offset = haystack.indexOf(needle, offset + Math.max(needle.length, 1));
      }
      return;
    }
    const atomText = searchableAtomText(node).toLowerCase();
    if (atomText && atomText.includes(needle)) {
      matches.push({ from: pos, to: pos + node.nodeSize, kind: "node" });
    }
  });
  return matches;
}

function searchableAtomText(node: ProseMirrorNode): string {
  if (!node.isAtom) return "";
  const attrs = node.attrs as Record<string, unknown>;
  switch (node.type.name) {
    case "bookmark":
      return [
        attrs.title,
        attrs.description,
        attrs.siteName,
        attrs.url,
      ]
        .filter(Boolean)
        .join(" ");
    case "linkMention":
      return [attrs.title, attrs.url].filter(Boolean).join(" ");
    default:
      return "";
  }
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function buildState(doc: ProseMirrorNode, query: string, index: number): PageFindState {
  const matches = findMatches(doc, query);
  return {
    query: query.trim(),
    index: normalizeIndex(index, matches.length),
    matches,
  };
}

function activeMatch(state: PageFindState): FindMatch | null {
  if (state.matches.length === 0) return null;
  return state.matches[state.index] ?? state.matches[0] ?? null;
}

function scrollActiveMatch(editor: Editor) {
  requestAnimationFrame(() => {
    const active = editor.view.dom.querySelector(".page-find-match.is-active");
    active?.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

export function setPageFind(editor: Editor, query: string, index = 0): PageFindState {
  const next = buildState(editor.state.doc, query, index);
  let tr = editor.state.tr.setMeta(pageFindKey, { query, index } satisfies PageFindMeta);
  const active = activeMatch(next);
  if (active) {
    tr =
      active.kind === "node"
        ? tr.setSelection(NodeSelection.create(editor.state.doc, active.from))
        : tr.setSelection(TextSelection.create(editor.state.doc, active.from, active.to));
  }
  editor.view.dispatch(tr);
  scrollActiveMatch(editor);
  return pageFindState(editor);
}

export function movePageFind(editor: Editor, direction: 1 | -1): PageFindState {
  const current = pageFindState(editor);
  if (!current.query || current.matches.length === 0) return current;
  return setPageFind(editor, current.query, current.index + direction);
}

export function clearPageFind(editor: Editor): PageFindState {
  editor.view.dispatch(editor.state.tr.setMeta(pageFindKey, { clear: true } satisfies PageFindMeta));
  return pageFindState(editor);
}

export function pageFindState(editor: Editor): PageFindState {
  return pageFindKey.getState(editor.state) ?? emptyState();
}

export const PageFind = Extension.create({
  name: "pageFind",

  addProseMirrorPlugins() {
    return [
      new Plugin<PageFindState>({
        key: pageFindKey,
        state: {
          init: emptyState,
          apply(tr, previous) {
            const meta = tr.getMeta(pageFindKey) as PageFindMeta | undefined;
            if (meta?.clear) return emptyState();
            if (meta && typeof meta.query === "string") {
              return buildState(tr.doc, meta.query, meta.index ?? 0);
            }
            if (tr.docChanged && previous.query) {
              return buildState(tr.doc, previous.query, previous.index);
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            const find = pageFindKey.getState(state) ?? emptyState();
            if (!find.query || find.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, index) => {
                const attrs = {
                  class:
                    index === find.index
                      ? "page-find-match is-active"
                      : "page-find-match",
                };
                return match.kind === "node"
                  ? Decoration.node(match.from, match.to, attrs)
                  : Decoration.inline(match.from, match.to, attrs);
              })
            );
          },
        },
      }),
    ];
  },
});
