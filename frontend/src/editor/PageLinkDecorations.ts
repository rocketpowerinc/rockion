import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getPageIcon, isInternalNoteHref } from "./pageIcons";
import { managedPageIDFromHref } from "./pagePaths.mjs";
import { imageIconURL, isImageIcon } from "./imageIcons.mjs";

// Renders a live icon before each internal page link. Ordinary embedded links
// receive a ↗ badge; authoritative managed dashboard entries do not.
export const PageLinkDecorations = Extension.create({
  name: "pageLinkDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-pagelink-deco"),
        view(view) {
          const refresh = () => {
            view.dispatch(
              view.state.tr.setMeta("rockion:page-icons-changed", true)
            );
          };
          window.addEventListener("rockion:page-icons-changed", refresh);
          return {
            destroy() {
              window.removeEventListener("rockion:page-icons-changed", refresh);
            },
          };
        },
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
                const managed = !!managedPageIDFromHref(href);
                decos.push(
                  Decoration.inline(from, to, {
                    class: managed
                      ? "page-link managed-page-link"
                      : "page-link embedded-page-link",
                  })
                );
                // Only one icon per contiguous link run.
                const contiguous = href === prevHref && from === prevEnd;
                if (!contiguous) {
                  decos.push(
                    Decoration.widget(from, () => buildIcon(href, managed), {
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

function buildIcon(href: string, managed: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = managed
    ? "page-link-icon managed-page-link-icon"
    : "page-link-icon embedded-page-link-icon";
  span.contentEditable = "false";

  const icon = getPageIcon(href);
  if (isImageIcon(icon)) {
    const img = document.createElement("img");
    img.src = imageIconURL(icon);
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
