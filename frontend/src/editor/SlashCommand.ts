import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";

import { filterSlashItems, type SlashItem } from "./slashItems";
import { SlashMenu, type SlashMenuRef } from "./SlashMenu";

// Notion-style "/" command menu. Positioned manually (no tippy/popper dependency).
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          (props as SlashItem).command({ editor, range });
        },
        render: () => {
          let component: ReactRenderer<SlashMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          const place = (rect: DOMRect | null) => {
            if (!popup || !rect) return;
            // clientRect is viewport-relative, so use fixed positioning.
            popup.style.position = "fixed";
            popup.style.left = `${rect.left}px`;
            // Flip above the caret if there isn't room below.
            const below = window.innerHeight - rect.bottom;
            if (below < 320) {
              popup.style.top = "";
              popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
            } else {
              popup.style.bottom = "";
              popup.style.top = `${rect.bottom + 6}px`;
            }
            popup.style.zIndex = "50";
          };

          const teardown = () => {
            popup?.remove();
            popup = null;
            component?.destroy();
            component = null;
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props,
                editor: props.editor,
              });
              popup = document.createElement("div");
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              place(props.clientRect?.() ?? null);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              place(props.clientRect?.() ?? null);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                teardown();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => teardown(),
          };
        },
      }),
    ];
  },
});
