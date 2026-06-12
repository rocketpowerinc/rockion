import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getPageIcon, isInternalNoteHref } from "./pageIcons";

// Renders an icon + ↗ badge before each internal page link, and tags the link
// with a class so it loses the underline. Pure decorations — the document and
// the markdown on disk are untouched (the link stays a plain `[Title](path.md)`).
export const PageLinkDecorations = Extension.create({
  name: "pageLinkDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-pagelink-deco"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            let prevHref: string | null = null;
            let prevEnd = -1;

            state.doc.descendants((node, pos) => {
              if (!node.isText) {
                prevHref = null;
                return;
              }
              const link = node.marks.find((m) => m.type.name === "link");
              const href: string | null = link ? link.attrs.href || "" : null;
              const internal = !!href && isInternalNoteHref(href);
              const from = pos;
              const to = pos + node.nodeSize;

              if (internal && href) {
                decos.push(Decoration.inline(from, to, { class: "page-link" }));
                // Only one icon per contiguous link run.
                const contiguous = href === prevHref && from === prevEnd;
                if (!contiguous) {
                  decos.push(
                    Decoration.widget(from, () => buildIcon(href), {
                      side: -1,
                      marks: [],
                    })
                  );
                }
              }
              prevHref = internal ? href : null;
              prevEnd = to;
            });

            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

function buildIcon(href: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "page-link-icon";
  span.contentEditable = "false";

  const icon = getPageIcon(href);
  if (icon && icon.startsWith("data:")) {
    const img = document.createElement("img");
    img.src = icon;
    img.className = "pli-img";
    img.alt = "";
    span.appendChild(img);
  } else {
    span.appendChild(document.createTextNode(icon || "📄"));
  }

  // Clicking the icon opens the page too (the link text is handled separately).
  span.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("rockion:open-page", { detail: href }));
  });

  return span;
}
