import {
  markPasteRule,
  type PasteRuleMatch,
} from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { find } from "linkifyjs";
import { shouldAutoLink } from "./linkPolicy.mjs";

// TipTap's normal link mark with one Rockion-specific policy: markdown
// filenames are never inferred as web links. Explicit [text](note.md) links
// continue to work because this filter only applies to automatic detection.
export const AutoLink = Link.extend({
  addPasteRules() {
    return [
      markPasteRule({
        find: (text) => {
          if (!text) return [];
          const { protocols, defaultProtocol } = this.options;
          return find(text)
            .filter(
              (item) =>
                item.isLink &&
                shouldAutoLink(item.value) &&
                this.options.isAllowedUri(item.value, {
                  defaultValidate: (href) => !!href,
                  protocols,
                  defaultProtocol,
                })
            )
            .map(
              (link): PasteRuleMatch => ({
                text: link.value,
                data: { href: link.href },
                index: link.start,
              })
            );
        },
        type: this.type,
        getAttributes: (match) => ({ href: match.data?.href }),
      }),
    ];
  },
}).configure({
  openOnClick: false,
  autolink: true,
  shouldAutoLink,
});
