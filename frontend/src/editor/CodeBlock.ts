import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import powershell from "highlight.js/lib/languages/powershell";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import markdown from "highlight.js/lib/languages/markdown";
import { api } from "../api";

// Supported languages. "" = plain text (no highlighting, no fence language).
const LANGS: { value: string; label: string; ext: string }[] = [
  { value: "", label: "Plain text", ext: "txt" },
  { value: "powershell", label: "PowerShell", ext: "ps1" },
  { value: "bash", label: "Bash", ext: "sh" },
  { value: "python", label: "Python", ext: "py" },
  { value: "go", label: "Go", ext: "go" },
  { value: "markdown", label: "Markdown", ext: "md" },
];

const lowlight = createLowlight();
lowlight.register("powershell", powershell);
lowlight.register("bash", bash);
lowlight.register("python", python);
lowlight.register("go", go);
lowlight.register("markdown", markdown);

// Code block with syntax highlighting + a hover toolbar (language, copy, download).
// On disk it stays a plain fenced block: ```powershell … ```
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;

      const dom = document.createElement("div");
      dom.className = "code-block";

      const toolbar = document.createElement("div");
      toolbar.className = "code-toolbar";
      toolbar.contentEditable = "false";

      // --- language dropdown ---
      const select = document.createElement("select");
      select.className = "code-lang";
      for (const l of LANGS) {
        const opt = document.createElement("option");
        opt.value = l.value;
        opt.textContent = l.label;
        select.appendChild(opt);
      }
      const langOf = (n: any): string => {
        const l = n.attrs.language || "";
        return LANGS.some((x) => x.value === l) ? l : "";
      };
      select.value = langOf(current);
      select.addEventListener("mousedown", (e) => e.stopPropagation());
      select.addEventListener("change", () => {
        if (typeof getPos !== "function") return;
        editor
          .chain()
          .command(({ tr }: any) => {
            tr.setNodeAttribute(getPos(), "language", select.value || null);
            return true;
          })
          .run();
      });

      // Current code text (read live from the document).
      const codeText = (): string => {
        if (typeof getPos === "function") {
          const pos = getPos();
          const n = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
          if (n) return n.textContent;
        }
        return current.textContent;
      };

      // --- copy button ---
      const copyBtn = makeBtn("Copy", "Copy to clipboard");
      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(codeText());
          flash(copyBtn, "Copied");
        } catch {
          flash(copyBtn, "Failed");
        }
      });

      // --- download button ---
      const dlBtn = makeBtn("Download", "Download script");
      dlBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const ext = (LANGS.find((l) => l.value === select.value) || LANGS[0]).ext;
        try {
          await api.saveFile(`script.${ext}`, codeText());
        } catch (err) {
          console.error("save failed:", err);
        }
      });

      toolbar.append(select, copyBtn, dlBtn);

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);

      dom.append(toolbar, pre);

      return {
        dom,
        contentDOM: code,
        update: (updated: any) => {
          if (updated.type !== current.type) return false;
          current = updated;
          select.value = langOf(updated);
          return true;
        },
        ignoreMutation: (mutation: any) => {
          if (mutation.type === "selection") return false;
          // Let ProseMirror manage the code content; ignore the toolbar chrome.
          if (mutation.target === code) return false;
          return !code.contains(mutation.target);
        },
      };
    };
  },
}).configure({ lowlight });

function makeBtn(text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "code-btn";
  b.textContent = text;
  b.title = title;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  return b;
}

function flash(btn: HTMLButtonElement, text: string) {
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = prev;
  }, 1200);
}
