import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Note, TreeNode } from "../api";
import {
  writingLanguageLabel,
  type WritingLanguage,
} from "../writingLanguage";
import { imageIconURL, isImageIcon } from "../editor/imageIcons.mjs";
import EmojiPicker from "./EmojiPicker";

interface Props {
  vaultName: string;
  tree: TreeNode[];
  favorites: TreeNode[];
  error?: string | null;
  theme: "light" | "dark";
  writingLanguage: WritingLanguage;
  collapsed: boolean;
  activePath: string | null;
  onOpen: (path: string) => void;
  onSetIcon: (path: string, icon: string) => void;
  onRenameProject: (dashboardPath: string, title: string) => Promise<Note>;
  onToggleCollapsed: () => void;
  onNewProject: () => void;
  onSearchVault: () => void;
  onGoHome: () => void;
  onOpenVault: () => void;
  onToggleTheme: () => void;
  onToggleWritingLanguage: () => void;
  onCheckForUpdate: () => Promise<void>;
  onExportVault: () => Promise<void>;
  onImportVault: () => Promise<void>;
  onReorderFavorites: (paths: string[]) => Promise<void>;
}

function HotkeyRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="settings-hotkey-row">
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </div>
  );
}

export default function Sidebar({
  vaultName,
  tree,
  favorites,
  error,
  theme,
  writingLanguage,
  collapsed,
  activePath,
  onOpen,
  onSetIcon,
  onRenameProject,
  onToggleCollapsed,
  onNewProject,
  onSearchVault,
  onGoHome,
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
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [unsortedOpen, setUnsortedOpen] = useState(true);
  const [draggedFavorite, setDraggedFavorite] = useState<string | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
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
      setHotkeysOpen(false);
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-head">
        <button
          className="vault-name"
          onClick={onOpenVault}
          title={vaultName || "Open another vault"}
          tabIndex={collapsed ? -1 : 0}
        >
          {vaultName || "Open vault…"}
        </button>
        <div className="sidebar-head-actions">
          <button
            className="icon-btn sidebar-collapse-button"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="icon-btn"
            title="Back to vault home"
            aria-label="Back to vault home"
            onClick={onGoHome}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 10.5 12 4l8 6.5v8a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 18.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button className="icon-btn" title="New project" onClick={onNewProject}>
            +
          </button>
          <button
            className="icon-btn"
            title="Search vault"
            aria-label="Search vault"
            onClick={onSearchVault}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="10.5"
                cy="10.5"
                r="5.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="m15 15 4.2 4.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <nav className="tree">
        {error && <div className="tree-empty tree-error">{error}</div>}
        <SidebarSection title="Favorites" collapsed={collapsed}>
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
        <SidebarSection title="Projects" collapsed={collapsed}>
          {!error && folders.length === 0 && (
            <div className="sidebar-section-empty">Create a project to add it here.</div>
          )}
          {folders.map((node) => (
            <ProjectRow
              key={node.path}
              node={node}
              activePath={activePath}
              collapsed={collapsed}
              iconPickerOpen={iconPickerFor === node.path}
              onOpen={onOpen}
              onOpenIconPicker={() => setIconPickerFor(node.path)}
              onCloseIconPicker={() => setIconPickerFor(null)}
              onSetIcon={onSetIcon}
              onRenameProject={onRenameProject}
            />
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
                setHotkeysOpen(false);
                onOpenVault();
              }}
            >
              <span>Open a New Vault</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                setHotkeysOpen(false);
                void onExportVault();
              }}
            >
              <span>Export Encrypted Vault</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                setHotkeysOpen(false);
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
                setHotkeysOpen(false);
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
                setHotkeysOpen(false);
              }}
            >
              <span>Writing Language</span>
              <span className="settings-menu-hint">
                {writingLanguageLabel(writingLanguage)}
              </span>
            </button>
            <button
              role="menuitem"
              aria-expanded={hotkeysOpen}
              onClick={() => setHotkeysOpen((open) => !open)}
            >
              <span>Hotkeys</span>
              <span className="settings-menu-hint">{hotkeysOpen ? "Hide" : "Show"}</span>
            </button>
            {hotkeysOpen && (
              <div className="settings-hotkeys" role="group" aria-label="Hotkey bindings">
                <HotkeyRow keys="Ctrl+T" label="Open page in new tab" />
                <HotkeyRow keys="Ctrl+Shift+T" label="Reopen closed tab" />
                <HotkeyRow keys="Ctrl+P" label="Open quick switcher" />
                <HotkeyRow keys="Ctrl+N" label="Create new project or vault" />
                <HotkeyRow keys="Ctrl+F" label="Find in current page" />
                <HotkeyRow keys="Ctrl+E" label="Toggle inline code" />
              </div>
            )}
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
  collapsed = false,
  onToggle,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className={`sidebar-section ${collapsed ? "is-compact" : ""}`}>
      <button
        className="sidebar-section-title"
        disabled={!collapsible}
        onClick={onToggle}
        title={title}
      >
        {collapsible && <span className="sidebar-section-chevron">{open ? "▾" : "▸"}</span>}
        {title}
      </button>
      {(!collapsible || open) && children}
    </section>
  );
}

function ProjectRow({
  node,
  activePath,
  collapsed,
  iconPickerOpen,
  onOpen,
  onOpenIconPicker,
  onCloseIconPicker,
  onSetIcon,
  onRenameProject,
}: {
  node: TreeNode;
  activePath: string | null;
  collapsed: boolean;
  iconPickerOpen: boolean;
  onOpen: (path: string) => void;
  onOpenIconPicker: () => void;
  onCloseIconPicker: () => void;
  onSetIcon: (path: string, icon: string) => void;
  onRenameProject: (dashboardPath: string, title: string) => Promise<Note>;
}) {
  const dashboardPath = node.entryPath || `${node.path}/dashboard.md`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(node.name);
  }, [node.name, node.path]);

  async function saveRename() {
    if (saving) return;
    const desired = name.trim();
    if (!desired || desired === node.name) {
      setName(node.name);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRenameProject(dashboardPath, desired);
      setEditing(false);
    } catch {
      setName(node.name);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`tree-row folder project-row ${
        activePath === dashboardPath ? "is-active" : ""
      }`}
    >
      <button
        className="tree-icon-btn"
        title={collapsed ? node.name : "Change project icon"}
        aria-label={collapsed ? `Open ${node.name}` : "Change project icon"}
        onClick={collapsed ? () => onOpen(dashboardPath) : onOpenIconPicker}
      >
        {isImageIcon(node.icon) ? (
          <img className="tree-icon-img" src={imageIconURL(node.icon)} alt="" />
        ) : (
          <span className="tree-icon">{node.icon || "📁"}</span>
        )}
      </button>
      {editing ? (
        <input
          className="project-name-input"
          value={name}
          disabled={saving}
          aria-label="Project name"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setName(node.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className="folder-open-btn"
          onClick={() => onOpen(dashboardPath)}
          title={node.name}
          aria-label={node.name}
        >
          {node.name}
        </button>
      )}
      {!editing && (
        <div className="project-row-actions">
          <button
            className="project-more-button"
            title={`Project options for ${node.name}`}
            aria-label={`Project options for ${node.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="project-row-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(true);
                }}
              >
                Rename
              </button>
            </div>
          )}
        </div>
      )}
      {iconPickerOpen && (
        <EmojiPicker
          onClose={onCloseIconPicker}
          assetName={node.name || "project-icon"}
          onPick={(icon) => {
            onCloseIconPicker();
            onSetIcon(dashboardPath, icon);
          }}
        />
      )}
    </div>
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
      title={node.name}
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
      {isImageIcon(node.icon) ? (
        <img className="tree-icon-img" src={imageIconURL(node.icon)} alt="" />
      ) : (
        <span className="tree-icon">{node.icon || "📄"}</span>
      )}
      <span className="tree-row-label">{node.name}</span>
    </button>
  );
}
