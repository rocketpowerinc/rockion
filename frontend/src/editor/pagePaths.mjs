function parts(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".");
}

export function normalizePagePath(path) {
  const output = [];
  for (const part of parts(path)) {
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

export function pageDirectory(path) {
  const values = parts(path);
  values.pop();
  return values.join("/");
}

export function resolvePageHref(sourcePath, href) {
  const raw = safeDecode(String(href || "").split(/[?#]/, 1)[0]);
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/")) return "";
  return normalizePagePath(`${pageDirectory(sourcePath)}/${raw}`);
}

export function relativePageHref(sourcePath, targetPath) {
  const source = parts(pageDirectory(sourcePath));
  const target = parts(targetPath);
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  const relative = [...source.map(() => ".."), ...target].join("/");
  return relative || targetPath.split("/").pop() || "";
}

export function managedPageHref(sourcePath, targetPath, pageId, title) {
  const href = relativePageHref(sourcePath, targetPath);
  const query = new URLSearchParams({
    "rockion-page": String(pageId || ""),
    "rockion-title": String(title || ""),
  });
  return `${href}?${query.toString()}`;
}

export function managedPageIDFromHref(href) {
  try {
    const value = String(href || "");
    const queryAt = value.indexOf("?");
    if (queryAt < 0) return "";
    return new URLSearchParams(value.slice(queryAt + 1).split("#", 1)[0]).get(
      "rockion-page"
    ) || "";
  } catch {
    return "";
  }
}

export function isInternalNoteHref(href) {
  const value = String(href || "");
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith("#") || value.startsWith("/")) return false;
  const path = value.split(/[?#]/, 1)[0];
  return /\.(md|markdown|mdx)$/i.test(path);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
