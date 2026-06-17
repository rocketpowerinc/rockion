export function isImageIcon(icon) {
  const value = String(icon || "");
  return value.startsWith("data:image/") || /^Assets\/Images\/[^?#<>"]+$/i.test(value);
}

export function assetURL(path) {
  const value = String(path || "").replace(/\\/g, "/");
  if (/^Assets\/(?:Images|Videos|Bookmarks)\//i.test(value)) return `/${value}`;
  return value;
}

export function imageIconURL(icon) {
  return assetURL(icon);
}
