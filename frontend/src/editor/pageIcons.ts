// A tiny global registry mapping note path -> icon (emoji or image asset).
// App keeps this in sync with the vault; the page-link decorations read from it
// so link icons are resolved live (never baked into the markdown on disk).

import {
  isInternalNoteHref,
  resolvePageHref,
} from "./pagePaths.mjs";

export { isInternalNoteHref };

let registry: Record<string, string> = {};
let currentPagePath = "";

export function setPageIcons(map: Record<string, string>) {
  registry = map || {};
  notifyPageIconsChanged();
}

export function setCurrentPagePath(path: string) {
  currentPagePath = path || "";
  notifyPageIconsChanged();
}

export function getPageIcon(path: string): string {
  if (!path) return "";
  const decoded = safeDecode(path);
  const resolved = resolvePageHref(currentPagePath, decoded);
  return registry[path] || registry[decoded] || registry[resolved] || "";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function notifyPageIconsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("rockion:page-icons-changed"));
  }
}
