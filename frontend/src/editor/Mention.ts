import { Node } from "@tiptap/core";
import { assetURL } from "./imageIcons.mjs";

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(String(url || "").trim());
}

// Resolve a stored favicon to something the WebView can actually load. The app's
// CSP is img-src 'self' data: blob:, so remote favicons are blocked — they must
// be downloaded into the vault first (see LinkPasteMenu). Local vault paths are
// served by the asset middleware; data: URIs pass through.
function displayFavicon(fav: string): string {
  const v = String(fav || "").replace(/\\/g, "/");
  if (/^Assets\//i.test(v)) return assetURL(v);
  if (v.startsWith("data:")) return v;
  if (isHttp(v)) return v; // remote (likely blocked by CSP, kept as a last resort)
  return "";
}

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
          const url = anchor.getAttribute("href") || "";
          if (!isHttp(url)) return false;
          return {
            url,
            title: anchor.textContent?.trim() || url,
            favicon: anchor.getAttribute("data-favicon") || "",
          };
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
    return ({ node }) => {
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

      dom.addEventListener("click", (event) => {
        event.preventDefault();
        if (isHttp(a.url)) {
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
          if (!isHttp(a.url)) {
            state.write(a.title || a.url);
            return;
          }
          state.write(
            `<a href="${escAttr(a.url)}" data-rockion-mention${
              a.favicon ? ` data-favicon="${escAttr(a.favicon)}"` : ""
            }>${escText(a.title || a.url)}</a>`
          );
        },
      },
    };
  },
});

function escAttr(value: string): string {
  return String(value).replace(/[<>"&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;"
  );
}

function escText(value: string): string {
  return String(value).replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}
