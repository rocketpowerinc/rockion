import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../api";

interface Props {
  vaultName: string;
  tree: TreeNode[];
  error?: string | null;
  theme: "light" | "dark";
  activePath: string | null;
  onOpen: (path: string) => void;
  onNewNote: (dir: string) => void;
  onOpenVault: () => void;
  onToggleTheme: () => void;
  onCheckForUpdate: () => Promise<void>;
}

export default function Sidebar({
  vaultName,
  tree,
  error,
  theme,
  activePath,
  onOpen,
  onNewNote,
  onOpenVault,
  onToggleTheme,
  onCheckForUpdate,
}: Props) {
  const items = Array.isArray(tree) ? tree : [];
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  async function checkForUpdate() {
    setCheckingUpdate(true);
    try {
      await onCheckForUpdate();
      setSettingsOpen(false);
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="vault-name" onClick={onOpenVault} title="Open another vault">
          {vaultName || "Open vault…"}
        </button>
        <div className="sidebar-head-actions">
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
      <div className="sidebar-footer" ref={settingsRef}>
        {settingsOpen && (
          <div className="settings-menu" role="menu">
            <button
              role="menuitem"
              disabled={checkingUpdate}
              onClick={() => void checkForUpdate()}
            >
              <span>Check for Updates</span>
              {checkingUpdate && <span className="settings-menu-hint">Checking…</span>}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenVault();
              }}
            >
              <span>Open a New Vault</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onToggleTheme();
                setSettingsOpen(false);
              }}
            >
              <span>Theme</span>
              <span className="settings-menu-hint">
                {theme === "dark" ? "Switch to light" : "Switch to dark"}
              </span>
            </button>
          </div>
        )}
        <button
          className="settings-button"
          title="Settings"
          aria-label="Settings"
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 4.8-1.7-1a7 7 0 0 0 0-.6l1.7-1a1 1 0 0 0 .4-1.3l-1.5-2.6a1 1 0 0 0-1.3-.4l-1.7 1a7 7 0 0 0-.6-.4V5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v2a7 7 0 0 0-.6.4l-1.7-1a1 1 0 0 0-1.3.4L3.4 9.4a1 1 0 0 0 .4 1.3l1.7 1a7 7 0 0 0 0 .6l-1.7 1a1 1 0 0 0-.4 1.3l1.5 2.6a1 1 0 0 0 1.3.4l1.7-1 .6.4v2a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-2l.6-.4 1.7 1a1 1 0 0 0 1.3-.4l1.5-2.6a1 1 0 0 0-.4-1.3Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
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
