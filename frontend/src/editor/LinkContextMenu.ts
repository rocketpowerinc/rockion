import { Extension, getMarkRange } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const LinkContextMenu = Extension.create({
  name: "rockionLinkContextMenu",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rockion-link-context-menu"),
        view: (view) => new LinkMenuView(view),
      }),
    ];
  },
});

class LinkMenuView {
  private view: EditorView;
  private menu: HTMLDivElement | null = null;

  constructor(view: EditorView) {
    this.view = view;
    view.dom.addEventListener("contextmenu", this.open);
  }

  private open = (event: MouseEvent) => {
    const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a");
    if (!anchor || !this.view.dom.contains(anchor)) {
      this.close();
      return;
    }

    const linkType = this.view.state.schema.marks.link;
    const coords = this.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!linkType || !coords) return;
    const $pos = this.view.state.doc.resolve(coords.pos);
    const range = getMarkRange($pos, linkType);
    if (!range) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.close();

    const menu = document.createElement("div");
    menu.className = "link-context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 48)}px`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove link";
    remove.addEventListener("mousedown", (click) => {
      click.preventDefault();
      const { state } = this.view;
      this.view.dispatch(
        state.tr
          .removeMark(range.from, range.to, linkType)
          .setMeta("preventAutolink", true)
      );
      this.view.focus();
      this.close();
    });
    menu.appendChild(remove);
    document.body.appendChild(menu);
    this.menu = menu;

    window.addEventListener("mousedown", this.closeOnOutside, true);
    window.addEventListener("blur", this.close);
    window.addEventListener("scroll", this.close, true);
  };

  private closeOnOutside = (event: MouseEvent) => {
    if (!this.menu?.contains(event.target as Node)) this.close();
  };

  private close = () => {
    this.menu?.remove();
    this.menu = null;
    window.removeEventListener("mousedown", this.closeOnOutside, true);
    window.removeEventListener("blur", this.close);
    window.removeEventListener("scroll", this.close, true);
  };

  destroy() {
    this.view.dom.removeEventListener("contextmenu", this.open);
    this.close();
  }
}
