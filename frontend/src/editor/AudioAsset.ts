import { Node } from "@tiptap/core";
import { assetURL } from "./imageIcons.mjs";
import {
  isSafeAudioSource,
  renderAudioAssetHTML,
  serializeAudioAsset,
  storedAudioSource,
} from "./audioMarkup.mjs";

// An audio block: the <audio> player is rendered by the node view; the
// <figcaption> is real editable content (content: "inline*"). On disk it
// round-trips as portable <figure><audio><figcaption> markup that renders in
// Obsidian/GitHub.
export const AudioAsset = Node.create({
  name: "audioAsset",
  group: "block",
  content: "inline*",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          const audio = element.matches("audio") ? element : element.querySelector("audio");
          return storedAudioSource(
            audio?.getAttribute("src") ||
              element.getAttribute("src") ||
              element.getAttribute("data-src") ||
              ""
          );
        },
      },
      title: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          const audio = element.matches("audio") ? element : element.querySelector("audio");
          return audio?.getAttribute("title") || element.getAttribute("data-title") || "";
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: "figure[data-rockion-audio]", contentElement: "figcaption" },
      { tag: "audio[src]" },
    ];
  },

  renderHTML({ node }) {
    const src = storedAudioSource(String(node.attrs.src ?? ""));
    if (!isSafeAudioSource(src)) {
      return ["span", { class: "blocked-remote-image" }, `Audio blocked: ${src || "remote audio"}`];
    }
    const title = String(node.attrs.title || "");
    const audioAttrs: Record<string, string> = {
      src: assetURL(src),
      controls: "",
      preload: "metadata",
    };
    if (title) audioAttrs.title = title;
    return [
      "figure",
      { "data-rockion-audio": "" },
      ["audio", audioAttrs],
      ["figcaption", 0],
    ];
  },

  addCommands() {
    return {
      setAudio:
        (attrs: { src: string; title?: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const src = storedAudioSource(String(node.attrs.src ?? ""));
      const title = String(node.attrs.title || src.split("/").pop() || "Audio");

      const dom = document.createElement("figure");
      dom.className = "audio-asset";
      dom.setAttribute("data-rockion-audio", "");

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = assetURL(src);
      audio.title = title;
      audio.contentEditable = "false";
      audio.draggable = false;
      dom.appendChild(audio);

      const actions = document.createElement("div");
      actions.className = "audio-asset-actions";
      actions.contentEditable = "false";
      actions.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "audio-asset-more";
      more.title = "Audio options";
      more.setAttribute("aria-label", "Audio options");
      more.textContent = "⋯";
      const menu = document.createElement("div");
      menu.className = "audio-asset-menu";
      menu.hidden = true;

      const focusCaption = () => {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.chain().focus().setTextSelection(pos + 1).run();
      };

      const items: [string, () => void][] = [
        ["Caption", focusCaption],
        [
          "Open in folder",
          () =>
            window.dispatchEvent(
              new CustomEvent("rockion:audio-asset-action", { detail: { action: "open", src } })
            ),
        ],
        [
          "Delete asset",
          () =>
            window.dispatchEvent(
              new CustomEvent("rockion:audio-asset-action", { detail: { action: "delete", src } })
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
      figcaption.className = "audio-asset-caption";
      figcaption.setAttribute("data-placeholder", "Write a caption…");
      dom.appendChild(figcaption);

      return {
        dom,
        contentDOM: figcaption,
        update: (updated: { type: unknown }) => updated.type === node.type,
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
          const src = storedAudioSource(String(node.attrs.src || ""));
          if (!isSafeAudioSource(src)) {
            state.write("[Blocked audio]");
            state.closeBlock(node);
            return;
          }
          const title = String(node.attrs.title || "");
          const caption = String(node.textContent || "").trim();
          state.write(serializeAudioAsset({ src, title }, caption));
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(audioMarkdownItPlugin);
          },
        },
      },
    };
  },
});

function audioMarkdownItPlugin(md: any) {
  const defaultRender =
    md.renderer.rules.html_block ||
    ((tokens: any, idx: number) => tokens[idx].content);
  md.renderer.rules.html_block = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const rendered = renderAudioAssetHTML(tokens[idx].content);
    if (!rendered) return defaultRender(tokens, idx, options, env, self);
    return rendered;
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audioAsset: {
      setAudio: (attrs: { src: string; title?: string }) => ReturnType;
    };
  }
}
