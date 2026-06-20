import { Node } from "@tiptap/core";
import {
  displayFavicon,
  isHttpURL,
  parseMentionElement,
  serializeMention,
} from "./linkPreviewMarkup.mjs";

export interface MentionAttrs {
  url: string;
  title: string;
  favicon: string;
}

// Notion-style inline web mention: the site favicon followed by the page title,
// not a blue link. Stored portably as <a data-rockion-mention href ...>Title</a>
// so other editors render it as an ordinary titled link.
export const Mention = Node.create({
  name: "linkMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      favicon: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-rockion-mention]",
        priority: 100,
        getAttrs: (el) => {
          const anchor = el as HTMLElement;
          return parseMentionElement(anchor);
        },
      },
    ];
  },

  renderHTML({ node }) {
    const a = node.attrs as MentionAttrs;
    const attrs: Record<string, string> = { href: a.url, "data-rockion-mention": "" };
    if (a.favicon) attrs["data-favicon"] = a.favicon;
    return ["a", attrs, a.title || a.url];
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const a = node.attrs as MentionAttrs;
      const dom = document.createElement("span");
      dom.className = "link-mention";
      dom.setAttribute("data-rockion-mention", "");
      dom.contentEditable = "false";
      dom.title = a.url;

      const iconSrc = displayFavicon(a.favicon);
      if (iconSrc) {
        const fav = document.createElement("img");
        fav.className = "link-mention-favicon";
        fav.alt = "";
        fav.addEventListener("error", () => fav.remove());
        fav.src = iconSrc;
        dom.appendChild(fav);
      }

      const label = document.createElement("span");
      label.className = "link-mention-label";
      label.textContent = a.title || a.url;
      dom.appendChild(label);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "link-mention-delete";
      deleteButton.title = "Delete mention";
      deleteButton.setAttribute("aria-label", "Delete mention");
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        window.dispatchEvent(
          new CustomEvent("rockion:mention-action", {
            detail: {
              action: "delete",
              pos,
              assets: /^Assets\/Bookmarks\//i.test(a.favicon || "") ? [a.favicon] : [],
            },
          })
        );
      });
      dom.appendChild(deleteButton);

      dom.addEventListener("click", (event) => {
        event.preventDefault();
        if (isHttpURL(a.url)) {
          window.dispatchEvent(new CustomEvent("rockion:open-external", { detail: a.url }));
        }
      });

      return { dom };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const a = node.attrs as MentionAttrs;
          if (!isHttpURL(a.url)) {
            state.write(a.title || a.url);
            return;
          }
          state.write(serializeMention(a));
        },
      },
    };
  },
});
