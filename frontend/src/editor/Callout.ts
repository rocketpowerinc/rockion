import { Node, mergeAttributes } from "@tiptap/core";

// Callout — a Notion-style highlighted box.
//
// On disk it is plain Markdown using the Obsidian / GitHub alert convention:
//
//   > [!NOTE]
//   > body text
//
// which any other Markdown app renders as a normal blockquote/alert. We add a
// markdown-it rule to read that syntax back into a callout node, and a
// serializer to write it out.

const KNOWN_TYPES = [
  "note",
  "info",
  "tip",
  "warning",
  "important",
  "caution",
  "danger",
];

// Click order for the icon: cycle through the neon callout palette
// (📌 ♻️ 🛑 ⚠️ ℹ️ ❓ ✅).
const CYBER_CYCLE = ["pin", "recycle", "stop", "warning", "info", "question", "success"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (type?: string) => ReturnType;
      toggleCallout: (type?: string) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "note",
        parseHTML: (el: HTMLElement) =>
          (el.getAttribute("data-callout") || "note").toLowerCase(),
        renderHTML: (attrs: { type?: string }) => ({
          "data-callout": attrs.type || "note",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // data-type lets the drag-handle treat callouts (incl. nested ones) as
    // draggable blocks, so you can drag one out of another.
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "callout", "data-type": "callout" }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (type = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { type }),
      toggleCallout:
        (type = "note") =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { type }),
    };
  },

  // Custom rendering with a clickable icon that cycles the callout style.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "callout";
      dom.setAttribute("data-callout", node.attrs.type || "note");
      dom.setAttribute("data-type", "callout"); // makes it draggable when nested

      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "callout-hit";
      hit.contentEditable = "false";
      hit.title = "Click to change style";
      hit.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof getPos !== "function") return;
        const cur = dom.getAttribute("data-callout") || "neon";
        const i = CYBER_CYCLE.indexOf(cur);
        const next = CYBER_CYCLE[(i + 1) % CYBER_CYCLE.length];
        editor
          .chain()
          .command(({ tr }: any) => {
            tr.setNodeAttribute(getPos(), "type", next);
            return true;
          })
          .run();
      });

      const content = document.createElement("div");
      content.className = "callout-content";

      dom.appendChild(hit);
      dom.appendChild(content);

      return {
        dom,
        contentDOM: content,
        update: (updated: any) => {
          if (updated.type !== node.type) return false;
          dom.setAttribute("data-callout", updated.attrs.type || "note");
          return true;
        },
        ignoreMutation: (mutation: any) => {
          if (mutation.type === "selection") return false;
          // Manage only the editable content; ignore our own chrome/attrs.
          return !content.contains(mutation.target);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        // doc -> markdown
        serialize(state: any, node: any) {
          const type = String(node.attrs.type || "note").toUpperCase();
          state.wrapBlock("> ", "> ", node, () => {
            state.write(`[!${type}]\n`);
            state.renderContent(node);
          });
        },
        // markdown -> doc (registers a markdown-it plugin)
        parse: {
          setup(markdownit: any) {
            markdownit.use(calloutMarkdownItPlugin);
          },
        },
      },
    };
  },
});

// --- markdown-it plugin: turn `> [!type]` blockquotes into callout divs ---

function calloutMarkdownItPlugin(md: any) {
  md.core.ruler.push("rockion_callout", (state: any) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== "blockquote_open") continue;

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (
        !paragraphOpen ||
        paragraphOpen.type !== "paragraph_open" ||
        !inline ||
        inline.type !== "inline"
      ) {
        continue;
      }

      const m = /^\[!(\w+)\][ \t]*\n?/.exec(inline.content);
      if (!m) continue;

      const type = m[1].toLowerCase();
      if (type === "indent") continue;

      // Find the matching blockquote_close (respecting nesting).
      let depth = 0;
      let close = -1;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_open") depth++;
        else if (tokens[j].type === "blockquote_close") {
          depth--;
          if (depth === 0) {
            close = j;
            break;
          }
        }
      }
      if (close === -1) continue;

      open.type = "callout_open";
      open.tag = "div";
      open.attrSet("data-callout", type);
      tokens[close].type = "callout_close";
      tokens[close].tag = "div";

      stripMarker(inline);
    }
  });

  md.renderer.rules.callout_open = (tokens: any, idx: number) => {
    const type = tokens[idx].attrGet("data-callout") || "note";
    return `<div data-callout="${escapeAttr(type)}" class="callout">\n`;
  };
  md.renderer.rules.callout_close = () => "</div>\n";
}

// Remove the leading `[!type]` marker from the first inline token of a callout.
function stripMarker(inline: any) {
  inline.content = inline.content.replace(/^\[!\w+\][ \t]*\n?/, "");
  const kids = inline.children || [];
  if (kids.length && kids[0].type === "text") {
    kids[0].content = kids[0].content.replace(/^\[!\w+\][ \t]*/, "");
    if (kids[0].content === "") {
      kids.shift();
      if (kids.length && kids[0].type === "softbreak") kids.shift();
    }
  }
}

function escapeAttr(s: string): string {
  return String(s).replace(/[<>"&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;"
  );
}

export const CALLOUT_TYPES = KNOWN_TYPES;
