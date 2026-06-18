import { Node, mergeAttributes } from "@tiptap/core";

// Portable indentation wrapper for arbitrary blocks.
//
// On disk this is stored as:
//
//   > [!INDENT]
//   > block content
//
// That keeps the file valid Markdown while letting Rockion render it as a
// plain visual indent instead of a quote/callout.
export const IndentBlock = Node.create({
  name: "indentBlock",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-rockion-indent]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "rockion-indent",
        "data-rockion-indent": "",
      }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.wrapBlock("> ", "> ", node, () => {
            state.write("[!INDENT]\n");
            state.renderContent(node);
          });
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(indentBlockMarkdownItPlugin);
          },
        },
      },
    };
  },
});

function indentBlockMarkdownItPlugin(md: any) {
  md.core.ruler.push("rockion_indent_block", (state: any) => {
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
        inline.type !== "inline" ||
        !/^\[!INDENT\][ \t]*\n?/i.test(inline.content)
      ) {
        continue;
      }

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

      open.type = "indent_block_open";
      open.tag = "div";
      open.attrSet("data-rockion-indent", "");
      tokens[close].type = "indent_block_close";
      tokens[close].tag = "div";
      stripIndentMarker(inline);
    }
  });

  md.renderer.rules.indent_block_open = () => '<div data-rockion-indent class="rockion-indent">\n';
  md.renderer.rules.indent_block_close = () => "</div>\n";
}

function stripIndentMarker(inline: any) {
  inline.content = inline.content.replace(/^\[!INDENT\][ \t]*\n?/i, "");
  const kids = inline.children || [];
  if (kids.length && kids[0].type === "text") {
    kids[0].content = kids[0].content.replace(/^\[!INDENT\][ \t]*/i, "");
    if (kids[0].content === "") {
      kids.shift();
      if (kids.length && kids[0].type === "softbreak") kids.shift();
    }
  }
}
