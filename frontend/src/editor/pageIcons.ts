// A tiny global registry mapping note path -> icon (emoji or data: URL).
// App keeps this in sync with the vault; the page-link decorations read from it
// so link icons are resolved live (never baked into the markdown on disk).

let registry: Record<string, string> = {};

export function setPageIcons(map: Record<string, string>) {
  registry = map || {};
}

export function getPageIcon(path: string): string {
  if (!path) return "";
  return registry[path] || registry[safeDecode(path)] || "";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// True for relative links that point at another note in the vault.
export function isInternalNoteHref(href: string): boolean {
  if (!href) return false;
  if (/^[a-z]+:/i.test(href)) return false; // http:, mailto:, etc.
  if (href.startsWith("#") || href.startsWith("/")) return false;
  return /\.(md|markdown|mdx)$/i.test(href);
}
