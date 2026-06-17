import { assetURL } from "./imageIcons.mjs";
import { escapeAttr, escapeText } from "./videoMarkup.mjs";

export function isHttpURL(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

export function storePreviewImage(value) {
  const v = String(value || "").trim();
  if (!v || isHttpURL(v)) return v;
  return v.replace(/^\/+/, "");
}

export function displayPreviewImage(value) {
  const v = storePreviewImage(value);
  if (!v || isHttpURL(v)) return v;
  return assetURL(v);
}

export function serializeBookmark(attrs) {
  const a = attrs || {};
  if (!isHttpURL(a.url)) return `[${a.title || a.url}](${a.url})`;
  let out = `<figure data-rockion-bookmark${
    a.favicon ? ` data-favicon="${escapeAttr(a.favicon)}"` : ""
  }${a.siteName ? ` data-site="${escapeAttr(a.siteName)}"` : ""}>\n`;
  out += `<a href="${escapeAttr(a.url)}">${escapeText(a.title || a.url)}</a>\n`;
  if (a.description) out += `<p>${escapeText(a.description)}</p>\n`;
  if (a.image) out += `<img src="${escapeAttr(storePreviewImage(a.image))}" alt="">\n`;
  out += `</figure>`;
  return out;
}

export function parseBookmarkElement(figure) {
  const anchor = figure?.querySelector?.("a");
  const url = anchor?.getAttribute("href") || figure?.getAttribute?.("data-url") || "";
  if (!isHttpURL(url)) return false;
  return {
    url,
    title: anchor?.textContent?.trim() || figure.getAttribute("data-title") || url,
    description: figure.querySelector("p")?.textContent?.trim() || "",
    image: storePreviewImage(figure.querySelector("img")?.getAttribute("src") || ""),
    favicon: figure.getAttribute("data-favicon") || "",
    siteName: figure.getAttribute("data-site") || "",
  };
}

export function displayFavicon(fav) {
  const v = String(fav || "").replace(/\\/g, "/");
  if (/^Assets\//i.test(v)) return assetURL(v);
  if (v.startsWith("data:")) return v;
  if (isHttpURL(v)) return v;
  return "";
}

export function serializeMention(attrs) {
  const a = attrs || {};
  if (!isHttpURL(a.url)) return a.title || a.url || "";
  return `<a href="${escapeAttr(a.url)}" data-rockion-mention${
    a.favicon ? ` data-favicon="${escapeAttr(a.favicon)}"` : ""
  }>${escapeText(a.title || a.url)}</a>`;
}

export function parseMentionElement(anchor) {
  const url = anchor?.getAttribute?.("href") || "";
  if (!isHttpURL(url)) return false;
  return {
    url,
    title: anchor.textContent?.trim() || url,
    favicon: anchor.getAttribute("data-favicon") || "",
  };
}
