import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { TreeNode } from "../api";
import { imageIconURL, isImageIcon } from "../editor/imageIcons.mjs";

const TAB_MENU_WIDTH = 184;
const TAB_MENU_GAP = 6;
const VIEWPORT_GUTTER = 8;

export interface OpenPageTab {
  path: string;
  title: string;
  icon?: string;
  pinned?: boolean;
}

interface Props {
  tabs: OpenPageTab[];
  current: OpenPageTab | null;
  activePath: string | null;
  pages: TreeNode[];
  onOpen: (path: string) => void;
  onNewTab: () => void;
  onTogglePin: (path: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
  onCloseAllUnpinned: () => void;
}

function tabTitle(tab: OpenPageTab, pages: TreeNode[]): string {
  return pages.find((page) => page.path === tab.path)?.name || tab.title || tab.path;
}

function tabIcon(tab: OpenPageTab, pages: TreeNode[]): string | undefined {
  return pages.find((page) => page.path === tab.path)?.icon || tab.icon;
}

function PageIcon({ icon }: { icon?: string }) {
  if (isImageIcon(icon)) {
    return <img className="page-tab-icon-img" src={imageIconURL(icon)} alt="" />;
  }
  return <span className="page-tab-icon">{icon || "📄"}</span>;
}

export default function PageTabs({
  tabs,
  current,
  activePath,
  pages,
  onOpen,
  onNewTab,
  onTogglePin,
  onReorder,
  onCloseAllUnpinned,
}: Props) {
  const [menu, setMenu] = useState<{
    path: string;
    title: string;
    pinned: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);

  if (tabs.length === 0 && !current) return null;
  const canDropOn = (target: OpenPageTab) => {
    const dragged = tabs.find((tab) => tab.path === draggingPath);
    return !!dragged && dragged.path !== target.path && !!dragged.pinned === !!target.pinned;
  };
  const openMenu = (
    event: ReactMouseEvent<HTMLElement>,
    tab: OpenPageTab,
    title: string
  ) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      path: tab.path,
      title,
      pinned: !!tab.pinned,
      x: Math.max(
        VIEWPORT_GUTTER,
        Math.min(rect.left, window.innerWidth - TAB_MENU_WIDTH - VIEWPORT_GUTTER)
      ),
      y: Math.max(
        VIEWPORT_GUTTER,
        Math.min(rect.bottom + TAB_MENU_GAP, window.innerHeight - 104)
      ),
    });
  };
  return (
    <div className="page-tabs" role="tablist" aria-label="Open pages">
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        const title = tabTitle(tab, pages);
        const icon = tabIcon(tab, pages);
        return (
          <div
            key={tab.path}
            className={`page-tab ${tab.pinned ? "is-pinned" : ""} ${active ? "is-active" : ""} ${
              draggingPath === tab.path ? "is-dragging" : ""
            }`}
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(event) => {
              setDraggingPath(tab.path);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.path);
            }}
            onDragEnd={() => setDraggingPath(null)}
            onDragOver={(event) => {
              if (!canDropOn(tab)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = draggingPath || event.dataTransfer.getData("text/plain");
              setDraggingPath(null);
              if (from && from !== tab.path) onReorder(from, tab.path);
            }}
            onContextMenu={(event) => openMenu(event, tab, title)}
          >
            <button
              type="button"
              className="page-tab-main"
              title={tab.pinned ? title : `${title} (right-click for options)`}
              onClick={() => onOpen(tab.path)}
            >
              <PageIcon icon={icon} />
              {!tab.pinned && <span className="page-tab-title">{title}</span>}
            </button>
          </div>
        );
      })}
      {current && !tabs.some((tab) => tab.path === current.path) && (
        <div className="page-tab is-current is-active" role="tab" aria-selected="true">
          <button type="button" className="page-tab-main" title={current.title}>
            <PageIcon icon={tabIcon(current, pages)} />
            <span className="page-tab-title">{tabTitle(current, pages)}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        className="page-tab-new"
        title="Open page in new tab"
        aria-label="Open page in new tab"
        onClick={onNewTab}
      >
        +
      </button>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="page-tab-menu block-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label={`Tab options for ${menu.title}`}
        >
          <button
            type="button"
            className="block-menu-item"
            role="menuitem"
            onClick={() => {
              onTogglePin(menu.path);
              setMenu(null);
            }}
          >
            {menu.pinned ? "Unpin tab" : "Pin tab"}
          </button>
          <div className="block-menu-sep page-tab-menu-sep" />
          <button
            type="button"
            className="block-menu-item"
            role="menuitem"
            onClick={() => {
              onCloseAllUnpinned();
              setMenu(null);
            }}
          >
            Close all tabs
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
