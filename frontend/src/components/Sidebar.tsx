import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TreeNode } from "../api";
import {
  writingLanguageLabel,
  type WritingLanguage,
} from "../writingLanguage";

interface Props {
  vaultName: string;
  tree: TreeNode[];
  favorites: TreeNode[];
  error?: string | null;
  theme: "light" | "dark";
  writingLanguage: WritingLanguage;
  activePath: string | null;
  onOpen: (path: string) => void;
  onNewProject: () => void;
  onOpenVault: () => void;
  onToggleTheme: () => void;
  onToggleWritingLanguage: () => void;
  onCheckForUpdate: () => Promise<void>;
  onExportVault: () => Promise<void>;
  onImportVault: () => Promise<void>;
  onReorderFavorites: (paths: string[]) => Promise<void>;
}

export default function Sidebar({
  vaultName,
  tree,
  favorites,
  error,
  theme,
  writingLanguage,
  activePath,
  onOpen,
  onNewProject,
  onOpenVault,
  onToggleTheme,
  onToggleWritingLanguage,
  onCheckForUpdate,
  onExportVault,
  onImportVault,
  onReorderFavorites,
}: Props) {
  const items = Array.isArray(tree) ? tree : [];
  const folders = items.filter((item) => item.isDir);
  const rootNotes = items.filter((item) => !item.isDir);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [unsortedOpen, setUnsortedOpen] = useState(true);
  const [draggedFavorite, setDraggedFavorite] = useState<string | null>(null);
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
          <button className="icon-btn" title="New project" onClick={onNewProject}>
            +
          </button>
        </div>
      </div>
      <nav className="tree">
        {error && <div className="tree-empty tree-error">{error}</div>}
        <SidebarSection title="Favorites">
          {favorites.length === 0 && (
            <div className="sidebar-section-empty">Star a page to keep it here.</div>
          )}
          {favorites.map((node) => (
            <PageRow
              key={node.path}
              node={node}
              activePath={activePath}
              onOpen={onOpen}
              favorite
              draggable
              dragging={draggedFavorite === node.path}
              onDragStart={() => setDraggedFavorite(node.path)}
              onDragEnd={() => setDraggedFavorite(null)}
              onDrop={() => {
                if (!draggedFavorite || draggedFavorite === node.path) return;
                const paths = favorites.map((favorite) => favorite.path);
                const from = paths.indexOf(draggedFavorite);
                const to = paths.indexOf(node.path);
                if (from < 0 || to < 0) return;
                paths.splice(to, 0, paths.splice(from, 1)[0]);
                setDraggedFavorite(null);
                void onReorderFavorites(paths);
              }}
            />
          ))}
        </SidebarSection>
        <SidebarSection title="Folders">
          {!error && folders.length === 0 && (
            <div className="sidebar-section-empty">Create a folder in the vault to add it here.</div>
          )}
          {folders.map((node) => (
            <button
              key={node.path}
              className={`tree-row folder sidebar-row-button ${
                activePath === node.entryPath ? "is-active" : ""
              }`}
              onClick={() => onOpen(node.entryPath || `${node.path}/dashboard.md`)}
            >
              <span className="tree-icon">📁</span>
              <span className="tree-row-label">{node.name}</span>
            </button>
          ))}
        </SidebarSection>
        {rootNotes.length > 0 && (
          <SidebarSection
            title="Unsorted"
            collapsible
            open={unsortedOpen}
            onToggle={() => setUnsortedOpen((open) => !open)}
          >
            {unsortedOpen &&
              rootNotes.map((node) => (
                <PageRow
                  key={node.path}
                  node={node}
                  activePath={activePath}
                  onOpen={onOpen}
                />
              ))}
          </SidebarSection>
        )}
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

function SidebarSection({
  title,
  children,
  collapsible = false,
  open = true,
  onToggle,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="sidebar-section">
      <button
        className="sidebar-section-title"
        disabled={!collapsible}
        onClick={onToggle}
      >
        {collapsible && <span className="sidebar-section-chevron">{open ? "▾" : "▸"}</span>}
        {title}
      </button>
      {(!collapsible || open) && children}
    </section>
  );
}

function PageRow({
  node,
  activePath,
  onOpen,
  favorite = false,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  node: TreeNode;
  activePath: string | null;
  onOpen: (path: string) => void;
  favorite?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  return (
    <button
      className={`tree-row file sidebar-row-button ${activePath === node.path ? "is-active" : ""} ${
        dragging ? "is-dragging" : ""
      }`}
      onClick={() => onOpen(node.path)}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.path);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.();
      }}
    >
      {favorite && <span className="favorite-drag-handle" aria-hidden="true">⋮⋮</span>}
      {node.icon && node.icon.startsWith("data:") ? (
        <img className="tree-icon-img" src={node.icon} alt="" />
      ) : (
        <span className="tree-icon">{node.icon || "📄"}</span>
      )}
      <span className="tree-row-label">{node.name}</span>
    </button>
  );
}
