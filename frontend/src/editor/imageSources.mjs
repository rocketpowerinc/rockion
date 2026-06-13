const dataImagePattern = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;
const schemePattern = /^[a-z][a-z0-9+.-]*:/i;

export function isSafeImageSource(source) {
  const value = String(source ?? "").trim();
  if (!value) return false;
  if (dataImagePattern.test(value) || value.startsWith("blob:")) return true;
  if (value.startsWith("//") || value.startsWith("\\\\")) return false;
  return !schemePattern.test(value);
}
