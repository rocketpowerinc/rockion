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

  const chooseURL = () => {
    acted.current = true;
    insertLink(current.url, current.url);
    setState(null);
  };

  // Download the site favicon into the vault so it renders under the app's CSP
  // (img-src 'self' — remote images are blocked). Stored host-named (github.com.png)
  // and reused across every link to the same site. Empty string on failure.
  const downloadFavicon = async (pageURL: string, discoveredFavicon = ""): Promise<string> => {
    if (discoveredFavicon) {
      try {
        return await api.saveFavicon(discoveredFavicon);
      } catch {
        /* fall back to the page's own favicon */
      }
    }
    try {
      return await api.saveFavicon(pageURL);
    } catch {
      return "";
    }
  };

  const chooseMention = async () => {
    acted.current = true;
    setLoading(true);
    let preview: LinkPreview = {
      url: current.url,
      title: current.url,
      description: "",
      image: "",
      favicon: "",
      siteName: "",
    };
    try {
      preview = await api.fetchLinkPreview(current.url);
    } catch {
      /* fall back to the raw URL */
    }
    const favicon = await downloadFavicon(current.url, preview.favicon);
    // Insert a Notion-style inline mention: the site favicon + page title (not a
    // blue link). Stored portably as <a data-rockion-mention>.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: current.from, to: current.to }, [
        { type: "linkMention", attrs: { url: current.url, title: preview.title || current.url, favicon } },
        { type: "text", text: " " },
      ])
      .run();
    setState(null);
    setLoading(false);
  };

  const chooseBookmark = async () => {
    acted.current = true;
    setLoading(true);
    let preview: LinkPreview = {
      url: current.url,
      title: current.url,
      description: "",
      image: "",
      favicon: "",
      siteName: "",
    };
    try {
      preview = await api.fetchLinkPreview(current.url);
    } catch {
      /* fall back to minimal card */
    }
    // Download the preview image into the vault so it renders reliably (no
    // hotlink/CORS failures) and works offline. Fall back to the remote URL.
    let image = preview.image || "";
    if (image) {
      try {
        image = await api.saveRemoteImage(image);
      } catch {
        /* keep the remote URL */
      }
    }
    // The footer favicon is also subject to the CSP, so download it locally too.
    const favicon = await downloadFavicon(current.url, preview.favicon);
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: current.from, to: current.to },
        {
          type: "bookmark",
          attrs: {
            url: preview.url || current.url,
            title: preview.title || current.url,
            description: preview.description || "",
            image,
            favicon: favicon || preview.favicon || "",
            siteName: preview.siteName || "",
          },
        }
      )
      .run();
    setState(null);
    setLoading(false);
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
