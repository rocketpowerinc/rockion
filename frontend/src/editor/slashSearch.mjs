export function normalizeSlashSearch(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\s\W_]+/g, "");
}

export function matchesSlashSearch(item, query) {
  const normalizedQuery = normalizeSlashSearch(query);
  if (!normalizedQuery) return true;
  return [item.title, item.hint, ...(item.aliases || [])].some((value) =>
    normalizeSlashSearch(value).includes(normalizedQuery)
  );
}
