import { Node } from "@tiptap/core";
import { assetURL } from "./imageIcons.mjs";

function storedVideoSource(source: string): string {
  return String(source ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function isSafeVideoSource(source: string): boolean {
  const value = storedVideoSource(source);
  return /^Assets\/Videos\/[^?#<>"]+\.mp4$/i.test(value);
}

// A video block: the player is rendered by the node view; the <figcaption> is
// real editable content (content: "inline*"), so the caption is normal text the
// user types — not an atom that typing would replace. On disk it round-trips as
// portable <figure><video><figcaption> markup that renders in Obsidian/GitHub.
export const VideoAsset = Node.create({
  name: "videoAsset",
  group: "block",
  content: "inline*",
  // Not node-level draggable: that would make the whole figure (incl. the
  // caption) a drag source and hijack text selection. The block is still movable
  // via the ⋮⋮ grip handle, like paragraphs.
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          const video = element.matches("video") ? element : element.querySelector("video");
          return storedVideoSource(
            video?.getAttribute("src") ||
              element.getAttribute("src") ||
              element.getAttribute("data-src") ||
              ""
          );
        },
      },
      title: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          const video = element.matches("video") ? element : element.querySelector("video");
          return video?.getAttribute("title") || element.getAttribute("data-title") || "";
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: "figure[data-rockion-video]", contentElement: "figcaption" },
      { tag: "video[src]" },
    ];
  },

  renderHTML({ node }) {
    const src = storedVideoSource(String(node.attrs.src ?? ""));
    if (!isSafeVideoSource(src)) {
      return ["span", { class: "blocked-remote-image" }, `Video blocked: ${src || "remote video"}`];
    }
    const title = String(node.attrs.title || "");
    const videoAttrs: Record<string, string> = {
      src: assetURL(src),
      controls: "",
      preload: "metadata",
    };
    if (title) videoAttrs.title = title;
    return [
      "figure",
      { "data-rockion-video": "" },
      ["video", videoAttrs],
      ["figcaption", 0],
    ];
  },

  addCommands() {
    return {
      setVideo:
        (attrs: { src: string; title?: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const src = storedVideoSource(String(node.attrs.src ?? ""));
      const title = String(node.attrs.title || src.split("/").pop() || "Video");

      const dom = document.createElement("figure");
      dom.className = "video-asset";
      dom.setAttribute("data-rockion-video", "");

      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = assetURL(src);
      video.title = title;
      video.contentEditable = "false";
      video.draggable = false;
      dom.appendChild(video);

      const actions = document.createElement("div");
      actions.className = "video-asset-actions";
      actions.contentEditable = "false";
      // Keep mousedown inside the controls from reaching ProseMirror, which would
      // otherwise select/redraw the node view and instantly re-hide the menu.
      actions.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "video-asset-more";
      more.title = "Video options";
      more.setAttribute("aria-label", "Video options");
      more.textContent = "⋯";
      const menu = document.createElement("div");
      menu.className = "video-asset-menu";
      menu.hidden = true;

      const focusCaption = () => {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        // pos is just before the node; pos + 1 is the start of its inline content.
        editor.chain().focus().setTextSelection(pos + 1).run();
      };

      const items: [string, () => void][] = [
        ["Caption", focusCaption],
        [
          "Open in folder",
          () =>
            window.dispatchEvent(
              new CustomEvent("rockion:video-asset-action", { detail: { action: "open", src } })
            ),
        ],
        [
          "Delete asset",
          () =>
            window.dispatchEvent(
              new CustomEvent("rockion:video-asset-action", { detail: { action: "delete", src } })
            ),
        ],
      ];
      for (const [label, run] of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          menu.hidden = true;
          run();
        });
        menu.appendChild(button);
      }
      more.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      actions.append(more, menu);
      dom.appendChild(actions);

      const figcaption = document.createElement("figcaption");
      figcaption.className = "video-asset-caption";
      figcaption.setAttribute("data-placeholder", "Write a caption…");
      dom.appendChild(figcaption);

      return {
        dom,
        contentDOM: figcaption,
        // Keep the same node view across updates (ProseMirror patches the caption
        // in place) instead of recreating it and resetting the menu.
        update: (updated: { type: unknown }) => updated.type === node.type,
        // Ignore DOM mutations outside the editable caption — e.g. toggling the
        // actions menu — so they don't trigger a node-view redraw.
        ignoreMutation: (mutation: { type: string; target: globalThis.Node }): boolean => {
          if (mutation.type === "selection") return false;
          return !figcaption.contains(mutation.target);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const src = storedVideoSource(String(node.attrs.src || ""));
          if (!isSafeVideoSource(src)) {
            state.write("[Blocked video]");
            state.closeBlock(node);
            return;
          }
          const title = String(node.attrs.title || "");
          const caption = String(node.textContent || "").trim();
          state.write(
            `<figure data-rockion-video>\n<video src="${escapeAttr(src)}" controls preload="metadata"${
              title ? ` title="${escapeAttr(title)}"` : ""
            }></video>\n`
          );
          if (caption) {
            state.write(`<figcaption>${escapeText(caption)}</figcaption>\n`);
          }
          state.write("</figure>");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(videoMarkdownItPlugin);
          },
        },
      },
    };
  },
});

function videoMarkdownItPlugin(md: any) {
  const defaultRender =
    md.renderer.rules.html_block ||
    ((tokens: any, idx: number) => tokens[idx].content);
  md.renderer.rules.html_block = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const parsed = parseVideoBlock(tokens[idx].content);
    if (!parsed) return defaultRender(tokens, idx, options, env, self);
    // Always emit a <figcaption> so TipTap's contentElement always resolves,
    // even when the saved caption is empty.
    return `<figure data-rockion-video><video src="${escapeAttr(assetURL(parsed.src))}" controls preload="metadata"${
      parsed.title ? ` title="${escapeAttr(parsed.title)}"` : ""
    }></video><figcaption>${escapeText(parsed.caption)}</figcaption></figure>\n`;
  };
}

// Handles both the current <figure>…<figcaption> form and the legacy bare
// <video> (with optional data-caption) so older pages keep working.
function parseVideoBlock(html: string): { src: string; title: string; caption: string } | null {
  const source = String(html || "").trim();
  const videoMatch = /<video\b([^>]*)>/i.exec(source);
  if (!videoMatch) return null;
  const attrs = videoMatch[1] || "";
  const src = storedVideoSource(attrValue(attrs, "src"));
  if (!src || !isSafeVideoSource(src)) return null;
  const title = attrValue(attrs, "title");
  let caption = "";
  const figcap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(source);
  if (figcap) {
    caption = decodeText(figcap[1].replace(/<[^>]*>/g, "").trim());
  } else {
    caption = attrValue(attrs, "data-caption");
  }
  return { src, title, caption };
}

function attrValue(attrs: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attrs);
  return decodeAttr(match?.[1] || match?.[2] || match?.[3] || "");
}

function escapeAttr(value: string): string {
  return String(value).replace(/[<>"&]/g, (char) =>
    char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&amp;"
  );
}

function decodeAttr(value: string): string {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function escapeText(value: string): string {
  return String(value).replace(/[<>&]/g, (char) =>
    char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&amp;"
  );
}

function decodeText(value: string): string {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoAsset: {
      setVideo: (attrs: { src: string; title?: string }) => ReturnType;
    };
  }
}
