import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { isSafeImageSource } from "./imageSources.mjs";

export const SafeImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes.src ?? "");
    if (!isSafeImageSource(source)) {
      const label = String(HTMLAttributes.alt || source || "remote image");
      return [
        "span",
        mergeAttributes(this.options.HTMLAttributes, {
          class: "blocked-remote-image",
          title: "Remote image loading is blocked to keep this vault private.",
        }),
        `Remote image blocked: ${label}`,
      ];
    }
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
}).configure({
  inline: false,
  allowBase64: true,
});
