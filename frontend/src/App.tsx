import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Editor, { type EditorHandle } from "./components/Editor";
import Backlinks from "./components/Backlinks";
import QuickSwitcher from "./components/QuickSwitcher";
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

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const closing = useRef(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem("rockion-theme") : null;
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

  const newNote = useCallback(
    async (dir: string) => {
      if (!(await flushEditor())) return;
      const title = window.prompt("Note title", "Untitled");
      if (!title) return;
      try {
        const created = await api.createNote(dir, title);
        await refreshTree();
        setNote(created);
      } catch (e) {
        setError(`Couldn't create note: ${String(e)}`);
      }
    },
    [flushEditor, refreshTree]
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
        activePath={note?.path ?? null}
        onOpen={openNote}
        onNewNote={newNote}
        onOpenVault={openVault}
        onToggleTheme={toggleTheme}
        onCheckForUpdate={checkForUpdate}
      />
      <main className="main">
        <Editor
          ref={editorRef}
          note={note}
          pages={pages}
          onDirtySaved={refreshTree}
          onOpenLink={openNote}
          onSetIcon={setIcon}
          onNoteUpdated={(updated) =>
            setNote((current) => (current?.path === updated.path ? updated : current))
          }
        />
        <Backlinks path={note?.path ?? null} onOpen={openNote} />
      </main>
      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onOpen={openNote}
      />
    </div>
  );
}
