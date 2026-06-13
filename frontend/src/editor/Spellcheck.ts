import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import nspell from "nspell";
import type { WritingLanguage } from "../writingLanguage";

const spellcheckPluginKey = new PluginKey<DecorationSet>("rockion-spellcheck");
const wordPattern = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const dictionaries = new Map<WritingLanguage, ReturnType<typeof nspell>>();
let activeLanguage: WritingLanguage = "en-US";

async function loadDictionary(language: WritingLanguage) {
  const cached = dictionaries.get(language);
  if (cached) return cached;

  const [affixModule, wordsModule] =
    language === "fr-FR"
      ? await Promise.all([
          import("../../node_modules/dictionary-fr/index.aff?raw"),
          import("../../node_modules/dictionary-fr/index.dic?raw"),
        ])
      : await Promise.all([
          import("../../node_modules/dictionary-en/index.aff?raw"),
          import("../../node_modules/dictionary-en/index.dic?raw"),
        ]);
  const dictionary = nspell({
    aff: affixModule.default,
    dic: wordsModule.default,
  });
  dictionaries.set(language, dictionary);
  return dictionary;
}

function normalizedWord(word: string): string {
  return word.replace(/’/g, "'");
}

function decorationsFor(doc: Parameters<typeof DecorationSet.create>[0]): DecorationSet {
  const dictionary = dictionaries.get(activeLanguage);
  if (!dictionary) return DecorationSet.empty;
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (parent?.type.spec.code || node.marks.some((mark) => mark.type.name === "code")) return;

    for (const match of node.text.matchAll(wordPattern)) {
      const word = match[0];
      const offset = match.index ?? 0;
      if (dictionary.correct(normalizedWord(word))) continue;
      const from = pos + offset;
      const to = from + word.length;
      decorations.push(
        Decoration.inline(from, to, {
          class: "spellcheck-error",
          "data-spelling": word,
          "data-from": String(from),
          "data-to": String(to),
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export async function refreshSpellcheck(
  editor: Editor,
  language: WritingLanguage
): Promise<void> {
  activeLanguage = language;
  // Clear annotations from the previous dictionary immediately.
  editor.view.dispatch(editor.state.tr.setMeta(spellcheckPluginKey, language));
  await loadDictionary(language);
  if (editor.isDestroyed || activeLanguage !== language) return;
  editor.view.dispatch(editor.state.tr.setMeta(spellcheckPluginKey, language));
}

export const Spellcheck = Extension.create({
  name: "rockionSpellcheck",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: spellcheckPluginKey,
        state: {
          init: (_, state) => decorationsFor(state.doc),
          apply: (transaction, decorations, _oldState, newState) => {
            if (transaction.docChanged || transaction.getMeta(spellcheckPluginKey)) {
              return decorationsFor(newState.doc);
            }
            return decorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations: (state) => spellcheckPluginKey.getState(state) ?? null,
        },
        view: (view) => new SpellcheckMenu(view),
      }),
    ];
  },
});

class SpellcheckMenu {
  private view: EditorView;
  private menu: HTMLDivElement | null = null;

  constructor(view: EditorView) {
    this.view = view;
    view.dom.addEventListener("contextmenu", this.open);
  }

  private open = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const misspelling = target?.closest<HTMLElement>(".spellcheck-error");
    if (!misspelling) {
      this.close();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.close();

    const word = misspelling.dataset.spelling ?? "";
    const from = Number(misspelling.dataset.from);
    const to = Number(misspelling.dataset.to);
    if (!word || !Number.isInteger(from) || !Number.isInteger(to)) return;

    const suggestions =
      dictionaries.get(activeLanguage)?.suggest(normalizedWord(word)).slice(0, 7) ?? [];
    const menu = document.createElement("div");
    menu.className = "spellcheck-menu";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    if (suggestions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "spellcheck-menu-empty";
      empty.textContent = "No suggestions";
      menu.appendChild(empty);
    } else {
      for (const suggestion of suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = suggestion;
        button.addEventListener("mousedown", (click) => {
          click.preventDefault();
          const { state } = this.view;
          const current = state.doc.textBetween(from, to, "");
          if (current !== word) {
            this.close();
            return;
          }
          this.view.dispatch(state.tr.insertText(matchCase(word, suggestion), from, to));
          this.view.focus();
          this.close();
        });
        menu.appendChild(button);
      }
    }

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

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
