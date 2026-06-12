import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../api";

interface Props {
  vaultName: string;
  tree: TreeNode[];
  error?: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  activePath: string | null;
  onOpen: (path: string) => void;
  onNewNote: (dir: string) => void;
  onOpenVault: () => void;
  onCheckForUpdate: () => Promise<void>;
}

export default function Sidebar({
  vaultName,
  tree,
  error,
  theme,
  onToggleTheme,
  activePath,
  onOpen,
  onNewNote,
  onOpenVault,
  onCheckForUpdate,
}: Props) {
  const items = Array.isArray(tree) ? tree : [];
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const appMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!appMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!appMenuRef.current?.contains(event.target as Node)) {
        setAppMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppMenuOpen(false);
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [appMenuOpen]);

  async function checkForUpdate() {
    setCheckingUpdate(true);
    try {
      await onCheckForUpdate();
      setAppMenuOpen(false);
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-identity">
          <div className="app-menu-wrap" ref={appMenuRef}>
            <button
              className="rockion-menu-button"
              onClick={() => setAppMenuOpen((open) => !open)}
              title="Rockion menu"
              aria-haspopup="menu"
              aria-expanded={appMenuOpen}
            >
              <img src="/Rockion-Hero.png" alt="Rockion" />
            </button>
            {appMenuOpen && (
              <div className="app-menu" role="menu">
                <button
                  role="menuitem"
                  disabled={checkingUpdate}
                  onClick={() => void checkForUpdate()}
                >
                  {checkingUpdate ? "Checking for Update…" : "Check for Update"}
                </button>
              </div>
            )}
          </div>
          <button className="vault-name" onClick={onOpenVault} title="Open another vault">
            {vaultName || "Open vault…"}
          </button>
        </div>
        <div className="sidebar-head-actions">
          <button
            className="icon-btn"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button className="icon-btn" title="New note" onClick={() => onNewNote("")}>
            +
          </button>
        </div>
      </div>
      <nav className="tree">
        {error && <div className="tree-empty tree-error">{error}</div>}
        {!error && items.length === 0 && (
          <div className="tree-empty">No markdown files here yet. Click + to create one.</div>
        )}
        {items.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            onOpen={onOpen}
          />
        ))}
      </nav>
    </aside>
  );
}

function TreeItem({
  node,
  depth,
  activePath,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);

  if (node.isDir) {
    return (
      <div>
        <div
          className="tree-row folder"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="chevron">{open ? "▾" : "▸"}</span>
          {node.name}
        </div>
        {open &&
          node.children?.map((c) => (
            <TreeItem
              key={c.path}
              node={c}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-row file ${activePath === node.path ? "is-active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      onClick={() => onOpen(node.path)}
    >
      {node.icon && node.icon.startsWith("data:") ? (
        <img className="tree-icon-img" src={node.icon} alt="" />
      ) : (
        <span className="tree-icon">{node.icon || "📄"}</span>
      )}
      {node.name}
    </div>
  );
}
