import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Editor, { type EditorHandle } from "./components/Editor";
import Backlinks from "./components/Backlinks";
import QuickSwitcher from "./components/QuickSwitcher";
import NewPageModal from "./components/NewPageModal";
import PagePicker, { type PageRef } from "./components/PagePicker";
import Dashboard from "./components/Dashboard";
import VaultTransferModal from "./components/VaultTransferModal";
import WelcomeDashboard from "./components/WelcomeDashboard";
import VaultSearch from "./components/VaultSearch";
import PageTabs, { type OpenPageTab } from "./components/PageTabs";
import Breadcrumbs, {
  type BreadcrumbItem,
} from "./components/Breadcrumbs";
import {
  api,
  onBeforeClose,
  onIndexReady,
  onVaultChanged,
  type Note,
  type TreeNode,
  type VaultInfo,
} from "./api";
import { setPageIcons } from "./editor/pageIcons";
import {
  normalizeWritingLanguage,
  type WritingLanguage,
} from "./writingLanguage";
import {
  loadVaultHistory,
  rememberVault,
  saveVaultHistory,
  toggleVaultPinned,
  updateVaultStats,
  type SavedVault,
} from "./vaultHistory.mjs";

function normalizeTabGroups(tabs: OpenPageTab[]): OpenPageTab[] {
  return [
    ...tabs.filter((tab) => tab.pinned),
    ...tabs.filter((tab) => !tab.pinned),
  ];
}

export default function App() {
  const nativeRuntime = api.isNativeRuntime();
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [pages, setPages] = useState<TreeNode[]>([]);
  const [favorites, setFavorites] = useState<TreeNode[]>([]);
  const [vaultRevision, setVaultRevision] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenPageTab[]>([]);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  const [vaultSearchOpen, setVaultSearchOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newVaultOpen, setNewVaultOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("rockion-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [savedVaults, setSavedVaults] = useState<SavedVault[]>(() =>
    loadVaultHistory()
  );
  const [vaultTransfer, setVaultTransfer] = useState<
    { mode: "export" } | { mode: "import"; archivePath: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const vaultRef = useRef<VaultInfo | null>(null);
  const closing = useRef(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem("rockion-theme") : null;
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [writingLanguage, setWritingLanguage] = useState<WritingLanguage>(() => {
    try {
      return normalizeWritingLanguage(localStorage.getItem("rockion-writing-language"));
    } catch {
      return "en-US";
    }
  });

  const vaultTabsKey = vault ? `rockion-open-tabs:${vault.path}` : "";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    api.setWindowTheme(theme);
    try {
      localStorage.setItem("rockion-theme", theme);
    } catch {
      /* localStorage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = writingLanguage;
    try {
      localStorage.setItem("rockion-writing-language", writingLanguage);
    } catch {
      /* localStorage unavailable */
    }
  }, [writingLanguage]);

  useEffect(() => {
    try {
      localStorage.setItem("rockion-sidebar-collapsed", String(sidebarCollapsed));
    } catch {
      /* localStorage unavailable */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!vaultTabsKey) {
      setOpenTabs([]);
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(vaultTabsKey) || "[]");
      if (!Array.isArray(parsed)) {
        setOpenTabs([]);
        return;
      }
      setOpenTabs(
        normalizeTabGroups(
          parsed
            .filter((tab) => tab && typeof tab.path === "string" && typeof tab.title === "string")
            .map((tab) => ({
              path: tab.path,
              title: tab.title,
              icon: typeof tab.icon === "string" ? tab.icon : undefined,
              pinned: !!tab.pinned,
            }))
        )
      );
    } catch {
      setOpenTabs([]);
    }
  }, [vaultTabsKey]);

  useEffect(() => {
    if (!vaultTabsKey) return;
    try {
      localStorage.setItem(vaultTabsKey, JSON.stringify(openTabs));
    } catch {
      /* localStorage unavailable */
    }
  }, [openTabs, vaultTabsKey]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    []
  );

  const rememberOpenTab = useCallback((opened: Note, asPinned = false) => {
    setOpenTabs((current) => {
      const existing = current.find((tab) => tab.path === opened.path);
      if (existing) {
        return normalizeTabGroups(
          current.map((tab) =>
            tab.path === opened.path
              ? {
                  ...tab,
                  title: opened.title,
                  icon: opened.icon,
                  pinned: tab.pinned || asPinned,
                }
              : tab
          )
        );
      }
      return normalizeTabGroups([
        ...current,
        {
          path: opened.path,
          title: opened.title,
          icon: opened.icon,
          pinned: asPinned,
        },
      ]);
    });
  }, []);

  const replaceCurrentUnpinnedTab = useCallback((opened: Note) => {
    setOpenTabs((current) => {
      if (current.some((tab) => tab.path === opened.path)) return current;
      const activeIndex = note?.path
        ? current.findIndex((tab) => tab.path === note.path && !tab.pinned)
        : -1;
      if (activeIndex < 0) return current;
      const next = [...current];
      next[activeIndex] = {
        path: opened.path,
        title: opened.title,
        icon: opened.icon,
        pinned: false,
      };
      return normalizeTabGroups(next);
    });
  }, [note?.path]);

  const updateOpenTab = useCallback((updated: Note) => {
    setOpenTabs((current) =>
      current.map((tab) =>
        tab.path === updated.path
          ? { ...tab, title: updated.title, icon: updated.icon }
          : tab
      )
    );
  }, []);

  const flushEditor = useCallback(async () => {
    return (await editorRef.current?.flushSave()) ?? true;
  }, []);

  const changeSavedVaults = useCallback(
    (change: (current: SavedVault[]) => SavedVault[]) => {
      setSavedVaults((current) => {
        const next = change(current);
        saveVaultHistory(next);
        return next;
      });
    },
    []
  );

  const activateVault = useCallback(
    (info: VaultInfo) => {
      vaultRef.current = info;
      setVault(info);
      changeSavedVaults((current) => rememberVault(current, info));
      setNote(null);
      setOpenTabs([]);
      setNavigationHistory([]);
      setError(null);
    },
    [changeSavedVaults]
  );

  const pageRefs = useMemo(
    () =>
      pages.map((page) => ({
        path: page.path,
        title: page.name,
        icon: page.icon,
      })),
    [pages]
  );

  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const byPath = new Map(pageRefs.map((page) => [page.path, page]));
    return navigationHistory.map((path, index) => {
      const page = byPath.get(path);
      const isCurrent = index === navigationHistory.length - 1 && note?.path === path;
      return {
        path,
        title: isCurrent ? note.title : page?.title || path.split("/").pop() || path,
        icon: isCurrent ? note.icon : page?.icon,
        current: isCurrent,
      };
    });
  }, [navigationHistory, note, pageRefs]);

  const currentTab = useMemo<OpenPageTab | null>(() => {
    if (!note) return null;
    return {
      path: note.path,
      title: note.title,
      icon: note.icon,
    };
  }, [note]);

  // Keep the page-link icon registry in sync so link icons resolve live.
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of pageRefs) map[p.path] = p.icon || "";
    setPageIcons(map);
  }, [pageRefs]);

  const refreshTree = useCallback(async () => {
    try {
      const [t, allPages, savedFavorites] = await Promise.all([
        api.listTree(),
        api.listPages(),
        api.listFavorites(),
      ]);
      setTree(Array.isArray(t) ? t : []);
      setPages(Array.isArray(allPages) ? allPages : []);
      setFavorites(Array.isArray(savedFavorites) ? savedFavorites : []);
      const activeVault = vaultRef.current;
      if (activeVault) {
        changeSavedVaults((current) =>
          updateVaultStats(current, activeVault.path, {
            pageCount: Array.isArray(allPages) ? allPages.length : 0,
            projectCount: Array.isArray(t)
              ? t.filter((item) => item.isDir).length
              : 0,
            favoriteCount: Array.isArray(savedFavorites)
              ? savedFavorites.length
              : 0,
          })
        );
      }
      setError(null);
    } catch (e) {
      console.error("listTree failed:", e);
      setError(`Couldn't load files: ${String(e)}`);
      setTree([]);
      setPages([]);
      setFavorites([]);
    }
  }, [changeSavedVaults]);

  const toggleFavorite = useCallback(
    async (path: string) => {
      try {
        const favorite = favorites.some((item) => item.path === path);
        await api.setFavorite(path, !favorite);
        await refreshTree();
      } catch (reason) {
        setError(`Couldn't update Favorites: ${String(reason)}`);
      }
    },
    [favorites, refreshTree]
  );

  const reorderFavorites = useCallback(
    async (paths: string[]) => {
      const byPath = new Map(favorites.map((item) => [item.path, item]));
      setFavorites(paths.map((path) => byPath.get(path)).filter(Boolean) as TreeNode[]);
      try {
        await api.reorderFavorites(paths);
      } catch (reason) {
        await refreshTree();
        setError(`Couldn't reorder favorites: ${String(reason)}`);
      }
    },
    [favorites, refreshTree]
  );

  // Set/clear a page's emoji icon.
  const setIcon = useCallback(
    async (path: string, icon: string) => {
      await api.setNoteIcon(path, icon);
      await refreshTree();
      setNote((n) => (n && n.path === path ? { ...n, icon: icon || undefined } : n));
      setOpenTabs((current) =>
        current.map((tab) =>
          tab.path === path ? { ...tab, icon: icon || undefined } : tab
        )
      );
    },
    [refreshTree]
  );

  const openVault = useCallback(async () => {
    if (!nativeRuntime) return;
    if (!(await flushEditor())) return;
    try {
      const info = await api.pickVault();
      activateVault(info);
      await refreshTree();
    } catch (e) {
      console.error("openVault failed:", e);
      setError(`Couldn't open vault: ${String(e)}`);
    }
  }, [activateVault, flushEditor, nativeRuntime, refreshTree]);

  const openRecentVault = useCallback(
    async (path: string) => {
      if (!nativeRuntime || !(await flushEditor())) return;
      try {
        const info = await api.openVault(path);
        activateVault(info);
        await refreshTree();
      } catch (reason) {
        setError(`Couldn't open saved vault: ${String(reason)}`);
      }
    },
    [activateVault, flushEditor, nativeRuntime, refreshTree]
  );

  const createVault = useCallback(
    async (name: string) => {
      if (!nativeRuntime || !(await flushEditor())) return;
      try {
        const info = await api.createVault(name.trim());
        setNewVaultOpen(false);
        activateVault(info);
        await refreshTree();
      } catch (reason) {
        setError(`Couldn't create vault: ${String(reason)}`);
        throw reason;
      }
    },
    [activateVault, flushEditor, nativeRuntime, refreshTree]
  );

  const togglePinnedVault = useCallback(
    (path: string) => {
      changeSavedVaults((current) => toggleVaultPinned(current, path));
    },
    [changeSavedVaults]
  );

  const goToVaultHome = useCallback(async () => {
    if (!(await flushEditor())) return;
    try {
      await api.closeVault();
      vaultRef.current = null;
      setVault(null);
      setTree([]);
      setPages([]);
      setFavorites([]);
      setNote(null);
      setOpenTabs([]);
      setNavigationHistory([]);
      setVaultRevision(0);
      setError(null);
    } catch (reason) {
      setError(`Couldn't return to vault home: ${String(reason)}`);
    }
  }, [flushEditor]);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await api.checkForUpdates();
      if (!update.updateAvailable) {
        window.alert(`Rockion ${update.currentVersion} is up to date.`);
        return;
      }
      if (!update.canAutoUpdate) {
        if (
          window.confirm(
            `Rockion ${update.latestVersion} is available. Open the download page?`
          )
        ) {
          api.openExternal(update.releaseUrl);
        }
        return;
      }
      if (
        !window.confirm(
          `Rockion ${update.latestVersion} is available. Download, verify, and install it now? Rockion will close during the update.`
        )
      ) {
        return;
      }
      if (!(await flushEditor())) {
        throw new Error("Rockion could not save pending editor changes.");
      }
      await api.installUpdate();
    } catch (reason) {
      const message = `Update check failed: ${String(reason)}`;
      setError(message);
      window.alert(message);
    }
  }, [flushEditor]);

  const beginVaultExport = useCallback(async () => {
    if (!(await flushEditor())) return;
    setVaultTransfer({ mode: "export" });
  }, [flushEditor]);

  const beginVaultImport = useCallback(async () => {
    if (!(await flushEditor())) return;
    try {
      const archivePath = await api.pickVaultImportArchive();
      if (archivePath) {
        setVaultTransfer({ mode: "import", archivePath });
      }
    } catch (reason) {
      setError(`Couldn't select vault archive: ${String(reason)}`);
    }
  }, [flushEditor]);

  const submitVaultTransfer = useCallback(
    async (password: string) => {
      if (!vaultTransfer) return;
      if (vaultTransfer.mode === "export") {
        const path = await api.exportVault(password);
        setVaultTransfer(null);
        if (path) {
          window.alert(`Encrypted vault exported to:\n${path}`);
        }
        return;
      }
      const info = await api.importVault(vaultTransfer.archivePath, password);
      activateVault(info);
      setVaultTransfer(null);
      await refreshTree();
    },
    [activateVault, refreshTree, vaultTransfer]
  );

  const openNote = useCallback(async (path: string, historyIndex?: number, asNewTab = false) => {
    if (note?.path === path) {
      if (asNewTab) rememberOpenTab(note);
      return;
    }
    if (!(await flushEditor())) return;
    try {
      const opened = await api.readNote(path);
      if (asNewTab) {
        rememberOpenTab(opened);
      } else {
        replaceCurrentUnpinnedTab(opened);
      }
      setNote(opened);
      setNavigationHistory((current) => {
        if (typeof historyIndex === "number") {
          return current.slice(0, historyIndex + 1);
        }
        // The breadcrumb trail is always rooted at the current project's
        // dashboard. Entering a different project resets the trail to that
        // project's root.
        const projectOf = (p: string) => {
          const slash = p.indexOf("/");
          return slash > 0 ? p.slice(0, slash) : "";
        };
        const project = projectOf(opened.path);
        const currentProject = current.length ? projectOf(current[0]) : null;
        if (current.length === 0 || project !== currentProject) {
          const dashboard = project ? `${project}/dashboard.md` : "";
          if (dashboard && dashboard !== opened.path) return [dashboard, opened.path];
          return [opened.path];
        }
        // Same project: revisiting a page already in the trail truncates back to
        // it (like a browser) instead of appending a duplicate.
        const existing = current.indexOf(opened.path);
        if (existing >= 0) return current.slice(0, existing + 1);
        return [...current, opened.path];
      });
      setError(null);
    } catch (e) {
      setError(`Couldn't open note: ${String(e)}`);
    }
  }, [flushEditor, note, rememberOpenTab, replaceCurrentUnpinnedTab]);

  const toggleTabPin = useCallback((path: string) => {
    setOpenTabs((current) => {
      const tab = current.find((item) => item.path === path);
      if (!tab) return current;
      const rest = current.filter((item) => item.path !== path);
      const updated = { ...tab, pinned: !tab.pinned };
      const firstUnpinned = rest.findIndex((item) => !item.pinned);
      const insertAt = updated.pinned
        ? firstUnpinned < 0
          ? rest.length
          : firstUnpinned
        : rest.findIndex((item) => !item.pinned);
      const next = [...rest];
      next.splice(insertAt < 0 ? next.length : insertAt, 0, updated);
      return normalizeTabGroups(next);
    });
  }, []);

  const reorderTabs = useCallback((fromPath: string, toPath: string) => {
    setOpenTabs((current) => {
      const from = current.findIndex((tab) => tab.path === fromPath);
      const to = current.findIndex((tab) => tab.path === toPath);
      if (from < 0 || to < 0 || from === to) return current;
      if (!!current[from].pinned !== !!current[to].pinned) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return normalizeTabGroups(next);
    });
  }, []);

  const closeAllUnpinnedTabs = useCallback(() => {
    setOpenTabs((current) => current.filter((tab) => tab.pinned));
  }, []);

  const openTabPickerPage = useCallback(
    (page: PageRef) => {
      setTabPickerOpen(false);
      void openNote(page.path, undefined, true);
    },
    [openNote]
  );

  const newProject = useCallback(async () => {
    if (!(await flushEditor())) return;
    setNewProjectOpen(true);
  }, [flushEditor]);

  const createProject = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const dashboard = await api.createProject(trimmed);
        setNewProjectOpen(false);
        await refreshTree();
        rememberOpenTab(dashboard);
        setNote(dashboard);
        setNavigationHistory([dashboard.path]);
        setError(null);
      } catch (e) {
        setError(`Couldn't create project: ${String(e)}`);
        throw e;
      }
    },
    [refreshTree, rememberOpenTab]
  );

  const renameProject = useCallback(
    async (dashboardPath: string, title: string) => {
      try {
        const renamed = await api.renameProject(dashboardPath, title);
        const previousProject = dashboardPath.replace(/\/dashboard\.md$/i, "");
        const renamedProject = renamed.path.replace(/\/dashboard\.md$/i, "");
        setNote((current) =>
          current?.path === dashboardPath ||
          current?.path.startsWith(`${previousProject}/`)
            ? current.path === dashboardPath
              ? renamed
              : {
                  ...current,
                  path: `${renamedProject}${current.path.slice(previousProject.length)}`,
                }
            : current
        );
        setNavigationHistory((current) =>
          current.map((path) =>
            path === previousProject || path.startsWith(`${previousProject}/`)
              ? `${renamedProject}${path.slice(previousProject.length)}`
              : path
          )
        );
        setOpenTabs((current) =>
          current.map((tab) => {
            if (tab.path !== previousProject && !tab.path.startsWith(`${previousProject}/`)) {
              return tab;
            }
            const nextPath = `${renamedProject}${tab.path.slice(previousProject.length)}`;
            return {
              ...tab,
              path: nextPath,
              title: nextPath === renamed.path ? renamed.title : tab.title,
              icon: nextPath === renamed.path ? renamed.icon : tab.icon,
            };
          })
        );
        await refreshTree();
        setError(null);
        return renamed;
      } catch (reason) {
        setError(`Couldn't rename project: ${String(reason)}`);
        throw reason;
      }
    },
    [refreshTree]
  );

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        if (vaultRef.current) {
          void newProject();
        } else if (nativeRuntime) {
          setNewVaultOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nativeRuntime, newProject]);

  // React to external vault changes and index readiness.
  useEffect(() => {
    const off1 = onIndexReady(() => {
      setVaultRevision((revision) => revision + 1);
      void refreshTree();
    });
    const off2 = onVaultChanged(() => {
      setVaultRevision((revision) => revision + 1);
      void refreshTree();
    });
    return () => {
      off1?.();
      off2?.();
    };
  }, [refreshTree]);

  useEffect(() => {
    return onBeforeClose(() => {
      if (closing.current) return;
      closing.current = true;
      void (async () => {
        if (await flushEditor()) {
          await api.confirmClose();
        } else {
          closing.current = false;
          setError("Rockion stayed open because pending edits could not be saved.");
        }
      })();
    });
  }, [flushEditor]);

  if (!vault) {
    return (
      <>
        <WelcomeDashboard
          nativeRuntime={nativeRuntime}
          vaults={savedVaults}
          error={error}
          onOpenVault={() => void openVault()}
          onCreateVault={() => setNewVaultOpen(true)}
          onOpenRecent={(path) => void openRecentVault(path)}
          onTogglePinned={togglePinnedVault}
          onImportVault={() => void beginVaultImport()}
          onOpenRepository={() =>
            api.openExternal("https://github.com/rocketpowerinc/rockion")
          }
        />
        {newVaultOpen && (
          <NewPageModal
            itemName="vault"
            onSubmit={createVault}
            onClose={() => setNewVaultOpen(false)}
          />
        )}
        {vaultTransfer && (
          <VaultTransferModal
            mode={vaultTransfer.mode}
            onSubmit={submitVaultTransfer}
            onClose={() => setVaultTransfer(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        vaultName={vault.name}
        tree={tree}
        favorites={favorites}
        error={error}
        theme={theme}
        writingLanguage={writingLanguage}
        collapsed={sidebarCollapsed}
        activePath={note?.path ?? null}
        onOpen={openNote}
        onSetIcon={setIcon}
        onRenameProject={renameProject}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNewProject={newProject}
        onSearchVault={() => setVaultSearchOpen(true)}
        onGoHome={() => void goToVaultHome()}
        onOpenVault={openVault}
        onToggleTheme={toggleTheme}
        onToggleWritingLanguage={() =>
          setWritingLanguage((current) => (current === "en-US" ? "fr-FR" : "en-US"))
        }
        onCheckForUpdate={checkForUpdate}
        onExportVault={beginVaultExport}
        onImportVault={beginVaultImport}
        onReorderFavorites={reorderFavorites}
      />
      <main className="main">
        <PageTabs
          tabs={openTabs}
          current={currentTab}
          activePath={note?.path ?? null}
          pages={pages}
          onOpen={(path) => void openNote(path)}
          onNewTab={() => setTabPickerOpen(true)}
          onTogglePin={toggleTabPin}
          onReorder={reorderTabs}
          onCloseAllUnpinned={closeAllUnpinnedTabs}
        />
        <Breadcrumbs
          items={breadcrumbs}
          onOpen={(index, path) => void openNote(path, index)}
        />
        {note && /(^|\/)dashboard\.md$/i.test(note.path) ? (
          <Dashboard
            note={note}
            onOpenPage={openNote}
            onError={setError}
            onRefreshTree={() => void refreshTree()}
            onNoteUpdated={(updated) =>
              {
                updateOpenTab(updated);
                setNote((current) => (current?.path === updated.path ? updated : current));
              }
            }
            onRenameProject={renameProject}
            onSetIcon={setIcon}
            refreshVersion={vaultRevision}
          />
        ) : (
          <Editor
            ref={editorRef}
            note={note}
            writingLanguage={writingLanguage}
            pages={pageRefs}
            isFavorite={favorites.some((favorite) => favorite.path === note?.path)}
            onPageCreated={refreshTree}
            onOpenLink={openNote}
            onSetIcon={setIcon}
            onToggleFavorite={toggleFavorite}
            onNoteUpdated={(updated) =>
              {
                updateOpenTab(updated);
                setNote((current) => (current?.path === updated.path ? updated : current));
              }
            }
            onNoteRenamed={(renamed) => {
              const previousPath = note?.path;
              setNote(renamed);
              if (previousPath && previousPath !== renamed.path) {
                setOpenTabs((current) =>
                  current.map((tab) =>
                    tab.path === previousPath
                      ? {
                          ...tab,
                          path: renamed.path,
                          title: renamed.title,
                          icon: renamed.icon,
                        }
                      : tab
                  )
                );
                setNavigationHistory((current) =>
                  current.map((path) => (path === previousPath ? renamed.path : path))
                );
              }
              void refreshTree();
            }}
          />
        )}
        <Backlinks path={note?.path ?? null} onOpen={openNote} />
      </main>
      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onOpen={openNote}
      />
      <PagePicker
        open={tabPickerOpen}
        pages={pageRefs}
        placeholder="Open page in tab…"
        onPick={openTabPickerPage}
        onClose={() => setTabPickerOpen(false)}
      />
      <VaultSearch
        open={vaultSearchOpen}
        onClose={() => setVaultSearchOpen(false)}
        onOpen={openNote}
      />
      {newProjectOpen && (
        <NewPageModal
          itemName="project"
          onSubmit={createProject}
          onClose={() => setNewProjectOpen(false)}
        />
      )}
      {vaultTransfer && (
        <VaultTransferModal
          mode={vaultTransfer.mode}
          onSubmit={submitVaultTransfer}
          onClose={() => setVaultTransfer(null)}
        />
      )}
    </div>
  );
}
