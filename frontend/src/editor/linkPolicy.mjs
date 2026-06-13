export function isMarkdownAutoLink(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;

  try {
    const url = new URL(raw, "http://rockion.local/");
    return (
      url.hostname.toLowerCase().endsWith(".md") ||
      url.pathname.toLowerCase().endsWith(".md")
    );
  } catch {
    return /(?:^|[/\\])[^/?#]+\.md(?:[?#].*)?$/i.test(raw);
  }
}

export function shouldAutoLink(value) {
  return !isMarkdownAutoLink(value);
}

const markdownFilenamePattern =
  /(?:https?:\/\/)?[^\s<>()\[\]{}"'`]+\.md(?:[?#][^\s<>()\[\]{}"'`]*)?/gi;

export function markdownFilenameRanges(text) {
  const value = String(text ?? "");
  return Array.from(value.matchAll(markdownFilenamePattern), (match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
  }));
}
