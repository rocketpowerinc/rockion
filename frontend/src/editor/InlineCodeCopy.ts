import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

function inlineCodeElement(target: EventTarget | null): HTMLElement | null {
  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Text
        ? target.parentElement
        : null;
  if (!element) return null;
  const code = element.closest("code");
  if (!(code instanceof HTMLElement)) return null;
  if (code.closest("pre")) return null;
  return code;
}

async function copyInlineCodeText(code: HTMLElement): Promise<boolean> {
  const text = code.textContent || "";
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function flashCopied(code: HTMLElement) {
  code.classList.add("is-copied");
  window.setTimeout(() => code.classList.remove("is-copied"), 700);
}

export const InlineCodeCopy = Extension.create({
  name: "inlineCodeCopy",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const code = inlineCodeElement(event.target);
              if (!code) return false;
              void copyInlineCodeText(code).then((copied) => {
                if (copied) flashCopied(code);
              });
              return true;
            },
          },
        },
      }),
    ];
  },
});
