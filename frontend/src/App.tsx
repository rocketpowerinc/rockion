import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Editor, { type EditorHandle } from "./components/Editor";
import Backlinks from "./components/Backlinks";
import QuickSwitcher from "./components/QuickSwitcher";
import NewPageModal from "./components/NewPageModal";
import VaultTransferModal from "./components/VaultTransferModal";
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

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newPageDir, setNewPageDir] = useState<string | null>(null);
  const [vaultTransfer, setVaultTransfer] = useState<
    { mode: "export" } | { mode: "import"; archivePath: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);
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

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    []
  );

  const flushEditor = useCallback(async () => {
    return (await editorRef.current?.flushSave()) ?? true;
  }, []);

  // Flatten the tree into a list of pages for the "link to page" picker.
  const pages = useMemo(() => {
    const out: { path: string; title: string; icon?: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) walk(n.children ?? []);
        else out.push({ path: n.path, title: n.name, icon: n.icon });
      }
    };
    walk(Array.isArray(tree) ? tree : []);
    return out;
  }, [tree]);

  // Keep the page-link icon registry in sync so link icons resolve live.
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of pages) map[p.path] = p.icon || "";
    setPageIcons(map);
  }, [pages]);

  const refreshTree = useCallback(async () => {
    try {
      const t = await api.listTree();
      setTree(Array.isArray(t) ? t : []);
      setError(null);
    } catch (e) {
      console.error("listTree failed:", e);
      setError(`Couldn't load files: ${String(e)}`);
      setTree([]);
    }
  }, []);

  // Set/clear a page's emoji icon.
  const setIcon = useCallback(
    async (path: string, icon: string) => {
      await api.setNoteIcon(path, icon);
      await refreshTree();
      setNote((n) => (n && n.path === path ? { ...n, icon: icon || undefined } : n));
    },
    [refreshTree]
  );

  const openVault = useCallback(async () => {
    if (!(await flushEditor())) return;
    try {
      const info = await api.pickVault();
      setVault(info);
      setNote(null);
      await refreshTree();
    } catch (e) {
      console.error("openVault failed:", e);
      setError(`Couldn't open vault: ${String(e)}`);
    }
  }, [flushEditor, refreshTree]);

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
      setVault(info);
      setNote(null);
      setVaultTransfer(null);
      setError(null);
      await refreshTree();
    },
    [refreshTree, vaultTransfer]
  );

  const openNote = useCallback(async (path: string) => {
    if (note?.path === path) return;
    if (!(await flushEditor())) return;
    try {
      setNote(await api.readNote(path));
      setError(null);
    } catch (e) {
      setError(`Couldn't open note: ${String(e)}`);
    }
  }, [flushEditor, note?.path]);

  // Open the in-app new-page prompt. (Native window.prompt returns null on
  // macOS under Wails, so a real modal is used instead.)
  const newNote = useCallback(
    async (dir: string) => {
      if (!(await flushEditor())) return;
      setNewPageDir(dir);
    },
    [flushEditor]
  );

  const createPage = useCallback(
    async (title: string) => {
      const dir = newPageDir ?? "";
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const created = await api.createNote(dir, trimmed);
        setNewPageDir(null);
        await refreshTree();
        setNote(created);
        setError(null);
      } catch (e) {
        // Keep the modal open so the user can pick a different title.
        setError(`Couldn't create note: ${String(e)}`);
      }
    },
    [newPageDir, refreshTree]
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
        void newNote("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newNote]);

  // React to external vault changes and index readiness.
  useEffect(() => {
    const off1 = onIndexReady(() => void refreshTree());
    const off2 = onVaultChanged(() => void refreshTree());
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
      <div className="welcome">
        <img className="hero-img" src="/Rockion-Hero.png" alt="Rockion" />
        <h1>Rockion</h1>
        <p>A local-first markdown workspace. Your notes stay plain files on disk.</p>
        <button className="primary" onClick={openVault}>
          Open a vault folder
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        vaultName={vault.name}
        tree={tree}
        error={error}
        theme={theme}
        writingLanguage={writingLanguage}
        activePath={note?.path ?? null}
        onOpen={openNote}
        onNewNote={newNote}
        onOpenVault={openVault}
        onToggleTheme={toggleTheme}
        onToggleWritingLanguage={() =>
          setWritingLanguage((current) => (current === "en-US" ? "fr-FR" : "en-US"))
        }
        onCheckForUpdate={checkForUpdate}
        onExportVault={beginVaultExport}
        onImportVault={beginVaultImport}
      />
      <main className="main">
        <Editor
          ref={editorRef}
          note={note}
          writingLanguage={writingLanguage}
          pages={pages}
          onDirtySaved={refreshTree}
          onOpenLink={openNote}
          onSetIcon={setIcon}
          onNoteUpdated={(updated) =>
            setNote((current) => (current?.path === updated.path ? updated : current))
          }
          onNoteRenamed={(renamed) => {
            setNote(renamed);
            void refreshTree();
          }}
        />
        <Backlinks path={note?.path ?? null} onOpen={openNote} />
      </main>
      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onOpen={openNote}
      />
      {newPageDir !== null && (
        <NewPageModal onSubmit={createPage} onClose={() => setNewPageDir(null)} />
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
