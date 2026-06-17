import { assetURL } from "./imageIcons.mjs";

export function storedVideoSource(source) {
  return String(source ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isSafeVideoSource(source) {
  const value = storedVideoSource(source);
  return /^Assets\/Videos\/[^?#<>"]+\.mp4$/i.test(value);
}

export function serializeVideoAsset(attrs, caption = "") {
  const src = storedVideoSource(String(attrs?.src || ""));
  if (!isSafeVideoSource(src)) return "[Blocked video]";
  const title = String(attrs?.title || "");
  const text = String(caption || "").trim();
  let out = `<figure data-rockion-video>\n<video src="${escapeAttr(src)}" controls preload="metadata"${
    title ? ` title="${escapeAttr(title)}"` : ""
  }></video>\n`;
  if (text) out += `<figcaption>${escapeText(text)}</figcaption>\n`;
  out += "</figure>";
  return out;
}

export function renderVideoAssetHTML(html) {
  const parsed = parseVideoBlock(html);
  if (!parsed) return "";
  return `<figure data-rockion-video><video src="${escapeAttr(assetURL(parsed.src))}" controls preload="metadata"${
    parsed.title ? ` title="${escapeAttr(parsed.title)}"` : ""
  }></video><figcaption>${escapeText(parsed.caption)}</figcaption></figure>\n`;
}

export function parseVideoBlock(html) {
  const source = String(html || "").trim();
  const videoMatch = /<video\b([^>]*)>/i.exec(source);
  if (!videoMatch) return null;
  const attrs = videoMatch[1] || "";
  const src = storedVideoSource(attrValue(attrs, "src"));
  if (!src || !isSafeVideoSource(src)) return null;
  const title = attrValue(attrs, "title");
  let caption = "";
  const figcap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(source);
  if (figcap) {
    caption = decodeText(figcap[1].replace(/<[^>]*>/g, "").trim());
  } else {
    caption = attrValue(attrs, "data-caption");
  }
  return { src, title, caption };
}

export function attrValue(attrs, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(String(attrs || ""));
  return decodeAttr(match?.[1] || match?.[2] || match?.[3] || "");
}

export function escapeAttr(value) {
  return String(value).replace(/[<>"&]/g, (char) =>
    char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&amp;"
  );
}

export function decodeAttr(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export function escapeText(value) {
  return String(value).replace(/[<>&]/g, (char) =>
    char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&amp;"
  );
}

export function decodeText(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
