import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";

export function titleHeadingRange(state: EditorState): { from: number; to: number } | null {
  const first = state.doc.firstChild;
  if (first?.type.name !== "heading" || first.attrs.level !== 1) return null;
  return { from: 1, to: first.nodeSize - 1 };
}

export function selectionTouchesPageTitle(state: EditorState): boolean {
  const range = titleHeadingRange(state);
  if (!range) return false;
  const { from, to } = state.selection;
  return from < range.to && to > range.from;
}

export const PageTitlePlainText = Extension.create({
  name: "pageTitlePlainText",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-page-title-plain-text"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const range = titleHeadingRange(newState);
          if (!range) return null;

          let hasMarks = false;
          newState.doc.nodesBetween(range.from, range.to, (node) => {
            if (node.isText && node.marks.length > 0) {
              hasMarks = true;
              return false;
            }
            return !hasMarks;
          });
          if (!hasMarks) return null;

          return newState.tr.removeMark(range.from, range.to);
        },
      }),
    ];
  },
});
