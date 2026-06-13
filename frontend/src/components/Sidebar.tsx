import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../api";
import {
  writingLanguageLabel,
  type WritingLanguage,
} from "../writingLanguage";

interface Props {
  vaultName: string;
  tree: TreeNode[];
  error?: string | null;
  theme: "light" | "dark";
  writingLanguage: WritingLanguage;
  activePath: string | null;
  onOpen: (path: string) => void;
  onNewNote: (dir: string) => void;
  onOpenVault: () => void;
  onToggleTheme: () => void;
  onToggleWritingLanguage: () => void;
  onCheckForUpdate: () => Promise<void>;
  onExportVault: () => Promise<void>;
  onImportVault: () => Promise<void>;
}

export default function Sidebar({
  vaultName,
  tree,
  error,
  theme,
  writingLanguage,
  activePath,
  onOpen,
  onNewNote,
  onOpenVault,
  onToggleTheme,
  onToggleWritingLanguage,
  onCheckForUpdate,
  onExportVault,
  onImportVault,
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
                setSettingsOpen(false);
                void onExportVault();
              }}
            >
              <span>Export Encrypted Vault</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                void onImportVault();
              }}
            >
              <span>Import Encrypted Vault</span>
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
            <button
              role="menuitem"
              onClick={() => {
                onToggleWritingLanguage();
                setSettingsOpen(false);
              }}
            >
              <span>Writing Language</span>
              <span className="settings-menu-hint">
                {writingLanguageLabel(writingLanguage)}
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
            <mask id="rk-gear-hole">
              <rect width="24" height="24" fill="white" />
              <circle cx="12" cy="12" r="3" fill="black" />
            </mask>
            <g fill="currentColor" mask="url(#rk-gear-hole)">
              <circle cx="12" cy="12" r="7.4" />
              <rect x="10.4" y="1.4" width="3.2" height="5" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(45 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(90 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(135 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(180 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(225 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(270 12 12)" />
              <rect x="10.4" y="1.4" width="3.2" height="5" transform="rotate(315 12 12)" />
            </g>
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
