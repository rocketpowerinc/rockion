const DOMAIN_PATTERN =
  /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;

export function normalizeExternalHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw;
  if (DOMAIN_PATTERN.test(raw)) return `https://${raw}`;
  return "";
}

export function isExternalHref(value) {
  return /^(https?:\/\/|mailto:)/i.test(String(value || ""));
}
