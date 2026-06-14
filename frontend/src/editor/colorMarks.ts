import { Mark, mergeAttributes } from "@tiptap/core";

// Cyberpunk palette. Text colors are vivid neons; background colors are the same
// hues at low alpha so they tint without hurting readability. Values are plain
// CSS, so a colored run serializes to <span style="…"> in the .md (portable —
// renders in Obsidian/GitHub) rather than any proprietary format.
export const TEXT_COLORS: { name: string; value: string }[] = [
  { name: "Green", value: "#39ff14" },
  { name: "Cyan", value: "#00e5ff" },
  { name: "Pink", value: "#ff2bd6" },
  { name: "Yellow", value: "#f6ff00" },
  { name: "Orange", value: "#ff7a00" },
  { name: "Purple", value: "#b14aed" },
  { name: "Red", value: "#ff3b5c" },
];

export const BG_COLORS: { name: string; value: string }[] = [
  { name: "Green", value: "rgba(57, 255, 20, 0.22)" },
  { name: "Cyan", value: "rgba(0, 229, 255, 0.20)" },
  { name: "Pink", value: "rgba(255, 43, 214, 0.22)" },
  { name: "Yellow", value: "rgba(246, 255, 0, 0.20)" },
  { name: "Orange", value: "rgba(255, 122, 0, 0.22)" },
  { name: "Purple", value: "rgba(177, 74, 237, 0.24)" },
  { name: "Red", value: "rgba(255, 59, 92, 0.22)" },
];

// Inline mark carrying a text color, rendered/parsed as a styled <span>.
export const TextColor = Mark.create({
  name: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (el) => {
          const color = (el as HTMLElement).style.color;
          return color ? { color } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

// Inline mark carrying a background color, rendered/parsed as a styled <span>.
export const BgColor = Mark.create({
  name: "bgColor",
  addAttributes() {
    return {
      background: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
        renderHTML: (attrs) =>
          attrs.background
            ? { style: `background-color: ${attrs.background}; border-radius: 3px; padding: 0 2px` }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (el) => {
          const bg = (el as HTMLElement).style.backgroundColor;
          return bg ? { background: bg } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
