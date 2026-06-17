import { Node } from "@tiptap/core";
import {
  displayPreviewImage,
  isHttpURL,
  parseBookmarkElement,
  serializeBookmark,
} from "./linkPreviewMarkup.mjs";

export interface BookmarkAttrs {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

// A Notion-style bookmark card. Stored as portable <figure data-rockion-bookmark>
// markup (a link + optional description + thumbnail) so it renders in
// Obsidian/GitHub/browsers, while Rockion paints it as a card.
export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
      favicon: { default: "" },
      siteName: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-rockion-bookmark]",
        getAttrs: (el) => {
          return parseBookmarkElement(el as HTMLElement);
        },
      },
    ];
  },

  renderHTML({ node }) {
    const a = node.attrs as BookmarkAttrs;
    if (!isHttpURL(a.url)) {
      return ["span", {}, a.url || "bookmark"];
    }
    const figureAttrs: Record<string, string> = { "data-rockion-bookmark": "" };
    if (a.favicon) figureAttrs["data-favicon"] = a.favicon;
    if (a.siteName) figureAttrs["data-site"] = a.siteName;
    const children: unknown[] = [["a", { href: a.url }, a.title || a.url]];
    if (a.description) children.push(["p", {}, a.description]);
    if (a.image) children.push(["img", { src: displayPreviewImage(a.image), alt: "" }]);
    return ["figure", figureAttrs, ...children] as never;
  },

  addCommands() {
    return {
      setBookmark:
        (attrs: BookmarkAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ({ node }) => {
      const a = node.attrs as BookmarkAttrs;
      const dom = document.createElement("div");
      dom.className = "bookmark-card";
      dom.setAttribute("data-rockion-bookmark", "");
      dom.contentEditable = "false";
      dom.title = a.url;
      dom.addEventListener("click", (event) => {
        event.preventDefault();
        if (isHttpURL(a.url)) {
          window.dispatchEvent(new CustomEvent("rockion:open-external", { detail: a.url }));
        }
      });

      const text = document.createElement("div");
      text.className = "bookmark-text";

      const title = document.createElement("div");
      title.className = "bookmark-title";
      title.textContent = a.title || a.url;
      text.appendChild(title);

      if (a.description) {
        const desc = document.createElement("div");
        desc.className = "bookmark-desc";
        desc.textContent = a.description;
        text.appendChild(desc);
      }

      const footer = document.createElement("div");
      footer.className = "bookmark-footer";
      if (a.favicon) {
        const fav = document.createElement("img");
        fav.className = "bookmark-favicon";
        fav.src = displayPreviewImage(a.favicon);
        fav.alt = "";
        fav.addEventListener("error", () => fav.remove());
        footer.appendChild(fav);
      }
      const host = document.createElement("span");
      host.className = "bookmark-url";
      host.textContent = a.url;
      footer.appendChild(host);
      text.appendChild(footer);

      dom.appendChild(text);

      if (a.image) {
        const thumb = document.createElement("img");
        thumb.className = "bookmark-image";
        thumb.src = displayPreviewImage(a.image);
        thumb.alt = "";
        thumb.addEventListener("error", () => thumb.remove());
        dom.appendChild(thumb);
      }

      return { dom };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const a = node.attrs as BookmarkAttrs;
          if (!isHttpURL(a.url)) {
            state.write(`[${a.title || a.url}](${a.url})`);
            state.closeBlock(node);
            return;
          }
          state.write(serializeBookmark(a));
          state.closeBlock(node);
        },
      },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (attrs: BookmarkAttrs) => ReturnType;
    };
  }
}
