import { Mark, mergeAttributes } from "@tiptap/core";
import {
  backgroundColorStyle,
  textColorStyle,
} from "./colorMarkup.mjs";

// Cyberpunk palette. Text colors are vivid neons; background colors are the same
// hues at low alpha so they tint without hurting readability. Values are plain
// CSS, so a colored run serializes to <span style="…"> in the .md (portable —
// renders in Obsidian/GitHub) rather than any proprietary format.
export const TEXT_COLORS: { name: string; value: string }[] = [
  { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#a8b0bd" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Lavender", value: "#c084fc" },
  { name: "Green", value: "#39ff14" },
  { name: "Teal", value: "#14f1d9" },
  { name: "Cyan", value: "#00e5ff" },
  { name: "Lime", value: "#b7ff00" },
  { name: "Pink", value: "#ff2bd6" },
  { name: "Coral", value: "#ff6b6b" },
  { name: "Yellow", value: "#f6ff00" },
  { name: "Gold", value: "#ffc400" },
  { name: "Orange", value: "#ff7a00" },
  { name: "Purple", value: "#b14aed" },
  { name: "Red", value: "#ff3b5c" },
];

export const BG_COLORS: { name: string; value: string }[] = [
  { name: "Gray", value: "rgba(168, 176, 189, 0.20)" },
  { name: "Blue", value: "rgba(59, 130, 246, 0.22)" },
  { name: "Indigo", value: "rgba(99, 102, 241, 0.22)" },
  { name: "Lavender", value: "rgba(192, 132, 252, 0.22)" },
  { name: "Green", value: "rgba(57, 255, 20, 0.22)" },
  { name: "Teal", value: "rgba(20, 241, 217, 0.20)" },
  { name: "Cyan", value: "rgba(0, 229, 255, 0.20)" },
  { name: "Lime", value: "rgba(183, 255, 0, 0.20)" },
  { name: "Pink", value: "rgba(255, 43, 214, 0.22)" },
  { name: "Coral", value: "rgba(255, 107, 107, 0.22)" },
  { name: "Yellow", value: "rgba(246, 255, 0, 0.20)" },
  { name: "Gold", value: "rgba(255, 196, 0, 0.22)" },
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
        renderHTML: (attrs) => {
          const style = textColorStyle(attrs.color);
          return style ? { style } : {};
        },
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
        renderHTML: (attrs) => {
          const style = backgroundColorStyle(attrs.background);
          return style ? { style } : {};
        },
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
