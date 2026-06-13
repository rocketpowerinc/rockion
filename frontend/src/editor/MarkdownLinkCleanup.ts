import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { markdownFilenameRanges } from "./linkPolicy.mjs";

// Editing an already-linked domain into a .md filename can leave only part of
// the old link mark behind. Remove link marks from the complete filename token,
// even when ProseMirror split it into differently marked text nodes.
export const MarkdownLinkCleanup = Extension.create({
  name: "markdownLinkCleanup",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-markdown-link-cleanup"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const linkType = newState.schema.marks.link;
          if (!linkType) return null;

          const transaction = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (!node.isTextblock) return;

            let runText = "";
            let runStart = -1;
            let runEnd = -1;
            const flush = () => {
              if (!runText) return;
              for (const range of markdownFilenameRanges(runText)) {
                const from = runStart + range.from;
                const to = runStart + range.to;
                if (newState.doc.rangeHasMark(from, to, linkType)) {
                  transaction.removeMark(from, to, linkType);
                  changed = true;
                }
              }
              runText = "";
              runStart = -1;
              runEnd = -1;
            };

            node.descendants((child, childPos) => {
              if (!child.isText || !child.text) {
                flush();
                return;
              }
              const absoluteStart = pos + 1 + childPos;
              if (runEnd !== absoluteStart) flush();
              if (runStart < 0) runStart = absoluteStart;
              runText += child.text;
              runEnd = absoluteStart + child.nodeSize;
            });
            flush();
            return false;
          });

          return changed ? transaction.setMeta("preventAutolink", true) : null;
        },
      }),
    ];
  },
});
