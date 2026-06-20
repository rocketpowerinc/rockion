import { assetURL } from "./imageIcons.mjs";
import { attrValue, decodeText, escapeAttr, escapeText } from "./videoMarkup.mjs";

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;

export function storedAudioSource(source) {
  return String(source ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isSafeAudioSource(source) {
  const value = storedAudioSource(source);
  return /^Assets\/Audio\/[^?#<>"]+$/i.test(value) && AUDIO_EXT.test(value);
}

export function serializeAudioAsset(attrs, caption = "") {
  const src = storedAudioSource(String(attrs?.src || ""));
  if (!isSafeAudioSource(src)) return "[Blocked audio]";
  const title = String(attrs?.title || "");
  const text = String(caption || "").trim();
  let out = `<figure data-rockion-audio>\n<audio src="${escapeAttr(src)}" controls preload="metadata"${
    title ? ` title="${escapeAttr(title)}"` : ""
  }></audio>\n`;
  if (text) out += `<figcaption>${escapeText(text)}</figcaption>\n`;
  out += "</figure>";
  return out;
}

export function renderAudioAssetHTML(html) {
  const parsed = parseAudioBlock(html);
  if (!parsed) return "";
  return `<figure data-rockion-audio><audio src="${escapeAttr(assetURL(parsed.src))}" controls preload="metadata"${
    parsed.title ? ` title="${escapeAttr(parsed.title)}"` : ""
  }></audio><figcaption>${escapeText(parsed.caption)}</figcaption></figure>\n`;
}

export function parseAudioBlock(html) {
  const source = String(html || "").trim();
  const audioMatch = /<audio\b([^>]*)>/i.exec(source);
  if (!audioMatch) return null;
  const attrs = audioMatch[1] || "";
  const src = storedAudioSource(attrValue(attrs, "src"));
  if (!src || !isSafeAudioSource(src)) return null;
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
