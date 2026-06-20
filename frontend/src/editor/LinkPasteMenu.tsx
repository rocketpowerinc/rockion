import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { api, type LinkPreview } from "../api";

interface PasteState {
  url: string;
  from: number;
  to: number;
  x: number;
  y: number;
}

// v2: bust stale entries cached before favicons rejected non-image responses
// (e.g. a site whose /favicon.ico returned an HTML challenge saved as a bad icon).
const FAVICON_CACHE_PREFIX = "rockion-favicon:v2:";

function faviconCacheKey(value: string): string {
  return `${FAVICON_CACHE_PREFIX}${value.trim().toLowerCase()}`;
}

function cachedFavicon(value: string): string {
  try {
    const cached = localStorage.getItem(faviconCacheKey(value));
    return cached && /^Assets\/Bookmarks\//i.test(cached) ? cached : "";
  } catch {
    return "";
  }
}

function rememberFavicon(value: string, path: string) {
  if (!/^Assets\/Bookmarks\//i.test(path)) return;
  try {
    localStorage.setItem(faviconCacheKey(value), path);
  } catch {
    /* localStorage unavailable */
  }
}

// "Paste as" menu (Notion-style) shown when a bare URL is pasted: Mention (an
// inline favicon + title chip), Bookmark (a preview card), or URL (the plain link).
export default function LinkPasteMenu({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<PasteState | null>(null);
  const [loading, setLoading] = useState(false);
  const acted = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPaste = (event: Event) => {
      acted.current = false;
      setState((event as CustomEvent).detail as PasteState);
      setLoading(false);
    };
    window.addEventListener("rockion:link-paste", onPaste);
    return () => window.removeEventListener("rockion:link-paste", onPaste);
  }, []);

  const insertLink = useCallback(
    (text: string, href: string) => {
      if (!editor || !state) return;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: state.from, to: state.to }, [
          { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
          { type: "text", text: " " },
        ])
        .run();
    },
    [editor, state]
  );

  // Dismissing without a choice still inserts the plain URL so the paste isn't lost.
  const dismiss = useCallback(() => {
    if (!acted.current && state) insertLink(state.url, state.url);
    acted.current = true;
    setState(null);
    setLoading(false);
  }, [insertLink, state]);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [state, dismiss]);

  if (!editor || !state) return null;

  const current = state;

  const updateMatchingNodes = (
    typeName: "linkMention" | "bookmark",
    url: string,
    attrs: Record<string, string>
  ) => {
    if (!editor || Object.keys(attrs).length === 0) return;
    let changed = false;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== typeName || node.attrs.url !== url) return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      changed = true;
      return true;
    });
    if (changed) {
      editor.view.dispatch(tr);
    }
  };

  const chooseURL = () => {
    acted.current = true;
    insertLink(current.url, current.url);
    setState(null);
  };

  // Download the site favicon into the vault so it renders under the app's CSP
  // (img-src 'self' — remote images are blocked). Stored content-addressed and
  // cached per URL locally so repeated pastes can render immediately.
  const downloadFavicon = async (pageURL: string, discoveredFavicon = ""): Promise<string> => {
    const cached = cachedFavicon(discoveredFavicon || pageURL) || cachedFavicon(pageURL);
    if (cached) return cached;
    if (discoveredFavicon) {
      try {
        const saved = await api.saveFavicon(discoveredFavicon);
        rememberFavicon(discoveredFavicon, saved);
        rememberFavicon(pageURL, saved);
        return saved;
      } catch {
        /* fall back to the page's own favicon */
      }
    }
    try {
      const saved = await api.saveFavicon(pageURL);
      rememberFavicon(pageURL, saved);
      return saved;
    } catch {
      return "";
    }
  };

  const chooseMention = async () => {
    acted.current = true;
    const pasted = current;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pasted.from, to: pasted.to }, [
        { type: "linkMention", attrs: { url: pasted.url, title: pasted.url, favicon: "" } },
        { type: "text", text: " " },
      ])
      .run();
    setState(null);
    setLoading(false);
    const initialFavicon = cachedFavicon(pasted.url);
    if (initialFavicon) {
      updateMatchingNodes("linkMention", pasted.url, { favicon: initialFavicon });
    }
    let preview: LinkPreview = {
      url: pasted.url,
      title: pasted.url,
      description: "",
      image: "",
      favicon: "",
      siteName: "",
    };
    const previewPromise = api.fetchLinkPreview(pasted.url).catch(() => preview);
    const faviconPromise = downloadFavicon(pasted.url);
    const favicon = await faviconPromise;
    if (favicon) {
      updateMatchingNodes("linkMention", pasted.url, { favicon });
    }
    preview = await previewPromise;
    const discoveredFavicon =
      preview.favicon && !favicon ? await downloadFavicon(pasted.url, preview.favicon) : favicon;
    updateMatchingNodes("linkMention", pasted.url, {
      title: preview.title || pasted.url,
      favicon: discoveredFavicon,
    });
  };

  const chooseBookmark = async () => {
    acted.current = true;
    const pasted = current;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pasted.from, to: pasted.to },
        {
          type: "bookmark",
          attrs: {
            url: pasted.url,
            title: pasted.url,
            description: "",
            image: "",
            favicon: "",
            siteName: "",
          },
        }
      )
      .run();
    setState(null);
    setLoading(false);
    const initialFavicon = cachedFavicon(pasted.url);
    if (initialFavicon) {
      updateMatchingNodes("bookmark", pasted.url, { favicon: initialFavicon });
    }
    let preview: LinkPreview = {
      url: pasted.url,
      title: pasted.url,
      description: "",
      image: "",
      favicon: "",
      siteName: "",
    };
    const previewPromise = api.fetchLinkPreview(pasted.url).catch(() => preview);
    const faviconPromise = downloadFavicon(pasted.url);
    const favicon = await faviconPromise;
    if (favicon) {
      updateMatchingNodes("bookmark", pasted.url, { favicon });
    }
    preview = await previewPromise;
    // Share one asset across mention + bookmark: use the downloaded site favicon
    // as the card's icon (no separate og:image). The same file is reused
    // everywhere, and the card renders at a consistent, fixed size.
    const discoveredFavicon =
      preview.favicon && !favicon ? await downloadFavicon(pasted.url, preview.favicon) : favicon;
    updateMatchingNodes("bookmark", pasted.url, {
      url: preview.url || pasted.url,
      title: preview.title || pasted.url,
      description: preview.description || "",
      image: discoveredFavicon || "",
      favicon: discoveredFavicon || "",
      siteName: preview.siteName || "",
    });
  };

  return (
    <div
      ref={ref}
      className="link-paste-menu"
      style={{ position: "fixed", left: current.x, top: current.y + 4 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="link-paste-label">Paste as</div>
      <button className="link-paste-item" disabled={loading} onClick={() => void chooseMention()}>
        Mention
      </button>
      <button className="link-paste-item" disabled={loading} onClick={() => void chooseBookmark()}>
        Bookmark
      </button>
      <button className="link-paste-item" disabled={loading} onClick={chooseURL}>
        URL
      </button>
      {loading && <div className="link-paste-loading">Loading…</div>}
    </div>
  );
}
