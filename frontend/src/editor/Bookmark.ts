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
    return ({ node, getPos }) => {
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

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "bookmark-delete";
      deleteButton.title = "Delete bookmark";
      deleteButton.setAttribute("aria-label", "Delete bookmark");
      deleteButton.textContent = "\u00d7";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        window.dispatchEvent(
          new CustomEvent("rockion:bookmark-action", {
            detail: {
              action: "delete",
              pos,
              assets: [a.image, a.favicon].filter((path) =>
                /^Assets\/Bookmarks\//i.test(path || "")
              ),
            },
          })
        );
      });
      dom.appendChild(deleteButton);

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
      const host = document.createElement("span");
      host.className = "bookmark-url";
      host.textContent = a.url;
      footer.appendChild(host);
      text.appendChild(footer);

      dom.appendChild(text);

      // The icon tile is the shared site favicon, shown at a fixed size (CSS uses
      // object-fit: contain) so the card height never depends on the icon's
      // intrinsic dimensions.
      const iconSrc = a.image || a.favicon;
      if (iconSrc) {
        const thumb = document.createElement("div");
        thumb.className = "bookmark-thumb";
        const img = document.createElement("img");
        img.className = "bookmark-thumb-img";
        img.src = displayPreviewImage(iconSrc);
        img.alt = "";
        img.addEventListener("error", () => thumb.remove());
        thumb.appendChild(img);
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
