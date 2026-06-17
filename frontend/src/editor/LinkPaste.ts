import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const SINGLE_URL = /^https?:\/\/\S+$/i;

// Intercepts a paste whose clipboard is exactly one bare URL and opens the
// "Paste as" menu (Mention / Bookmark / URL). Anything else pastes normally.
export const LinkPaste = Extension.create({
  name: "linkPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-link-paste"),
        props: {
          handlePaste: (view, event) => {
            if (!view.editable) return false;
            const text = (event.clipboardData?.getData("text/plain") || "").trim();
            if (!SINGLE_URL.test(text)) return false;
            const { from, to } = view.state.selection;
            const coords = view.coordsAtPos(from);
            window.dispatchEvent(
              new CustomEvent("rockion:link-paste", {
                detail: { url: text, from, to, x: coords.left, y: coords.bottom },
              })
            );
            return true; // suppress the default paste; the menu inserts instead
          },
        },
      }),
    ];
  },
});
