import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import Backlinks from "./components/Backlinks";
import QuickSwitcher from "./components/QuickSwitcher";
import {
  api,
  onIndexReady,
  onVaultChanged,
  type Note,
  type TreeNode,
  type VaultInfo,
} from "./api";

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem("rockion-theme") : null;
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("rockion-theme", theme);
    } catch {
      /* localStorage unavailable */
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // Flatten the tree into a list of pages for the "link to page" picker.
  const pages = useMemo(() => {
    const out: { path: string; title: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) walk(n.children ?? []);
        else out.push({ path: n.path, title: n.name });
      }
    };
    walk(Array.isArray(tree) ? tree : []);
    return out;
  }, [tree]);

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

  const openVault = useCallback(async () => {
    try {
      const info = await api.pickVault();
      setVault(info);
      setNote(null);
      await refreshTree();
    } catch (e) {
      console.error("openVault failed:", e);
      setError(`Couldn't open vault: ${String(e)}`);
    }
  }, [refreshTree]);

  const openNote = useCallback(async (path: string) => {
    setNote(await api.readNote(path));
  }, []);

  const newNote = useCallback(
    async (dir: string) => {
      const title = window.prompt("Note title", "Untitled");
      if (!title) return;
      const created = await api.createNote(dir, title);
      await refreshTree();
      setNote(created);
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

  if (!vault) {
    return (
      <div className="welcome">
        <button
          className="icon-btn theme-toggle-floating"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
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
        onToggleTheme={toggleTheme}
        activePath={note?.path ?? null}
        onOpen={openNote}
        onNewNote={newNote}
        onOpenVault={openVault}
      />
      <main className="main">
        <Editor note={note} pages={pages} onDirtySaved={refreshTree} onOpenLink={openNote} />
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
