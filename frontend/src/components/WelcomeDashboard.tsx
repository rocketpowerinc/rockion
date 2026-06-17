import type { SavedVault } from "../vaultHistory.mjs";
import { summarizeVaultHistory } from "../vaultHistory.mjs";
import { useEffect, useState } from "react";
import { api, type PageHistorySummary } from "../api";

interface Props {
  nativeRuntime: boolean;
  vaults: SavedVault[];
  error: string | null;
  onOpenVault: () => void;
  onCreateVault: () => void;
  onOpenRecent: (path: string) => void;
  onTogglePinned: (path: string) => void;
  onImportVault: () => void;
  onOpenRepository: () => void;
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return "Previously opened";
  const elapsed = Date.now() - timestamp;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Opened just now";
  if (minutes < 60) return `Opened ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Opened ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Opened ${days}d ago`;
  return `Opened ${new Date(timestamp).toLocaleDateString()}`;
}

function historyTime(timestamp: number): string {
  if (!timestamp) return "No versions yet";
  return new Date(timestamp).toLocaleString();
}

function VaultRow({
  vault,
  nativeRuntime,
  onOpen,
  onTogglePinned,
}: {
  vault: SavedVault;
  nativeRuntime: boolean;
  onOpen: () => void;
  onTogglePinned: () => void;
}) {
  return (
    <div className="welcome-vault-row">
      <button
        className="welcome-vault-open"
        disabled={!nativeRuntime}
        onClick={onOpen}
        title={vault.path}
      >
        <span className="welcome-vault-icon" aria-hidden="true">
          R
        </span>
        <span className="welcome-vault-copy">
          <strong>{vault.name}</strong>
          <small>{relativeTime(vault.lastOpened)}</small>
          <small className="welcome-vault-path">{vault.path}</small>
        </span>
      </button>
      <button
        className={`welcome-pin${vault.pinned ? " active" : ""}`}
        onClick={onTogglePinned}
        aria-label={vault.pinned ? `Unpin ${vault.name}` : `Pin ${vault.name}`}
        title={vault.pinned ? "Unpin vault" : "Pin vault"}
      >
        {vault.pinned ? "★" : "☆"}
      </button>
    </div>
  );
}

export default function WelcomeDashboard({
  nativeRuntime,
  vaults,
  error,
  onOpenVault,
  onCreateVault,
  onOpenRecent,
  onTogglePinned,
  onImportVault,
  onOpenRepository,
}: Props) {
  const pinned = vaults.filter((vault) => vault.pinned);
  const stats = summarizeVaultHistory(vaults);
  const [historyItems, setHistoryItems] = useState<PageHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const paths = vaults.map((vault) => vault.path);
    if (!nativeRuntime || paths.length === 0) {
      setHistoryItems([]);
      return () => {};
    }
    setHistoryLoading(true);
    setHistoryError(null);
    void api
      .recentHistoryForVaults(paths, 6)
      .then((items) => {
        if (!cancelled) setHistoryItems(items);
      })
      .catch((reason) => {
        if (!cancelled) setHistoryError(`Couldn't load version history: ${String(reason)}`);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nativeRuntime, vaults]);

  async function clearSavedVaultHistory() {
    if (!window.confirm("Clear version history for every saved vault?")) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      await Promise.all(vaults.map((vault) => api.clearHistoryForVault(vault.path)));
      setHistoryItems([]);
    } catch (reason) {
      setHistoryError(`Couldn't clear version history: ${String(reason)}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <main className="welcome">
      <header className="welcome-hero">
        <img className="hero-img" src="/Rockion-Hero.png" alt="Rockion" />
        <div>
          <h1>Rockion</h1>
          <p>A local-first markdown workspace.</p>
          <button className="welcome-repository-link" onClick={onOpenRepository}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.8 4.6 18.8 5 18.8 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.4 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.4 11.4 0 0 0 12 .8Z"
              />
            </svg>
            rocketpowerinc/rockion
          </button>
        </div>
        <div className="welcome-primary-actions">
          <button className="primary" onClick={onCreateVault} disabled={!nativeRuntime}>
            Create new vault
          </button>
          <button className="welcome-secondary" onClick={onOpenVault} disabled={!nativeRuntime}>
            Open vault
          </button>
        </div>
      </header>

      {!nativeRuntime && (
        <p className="browser-preview-note">
          Browser preview mode. Vault access and native file dialogs are available in
          the Rockion desktop window started by <code>wails dev</code>.
        </p>
      )}
      {error && <div className="welcome-error">{error}</div>}

      <div className="welcome-grid">
        <section className="welcome-card welcome-vaults-card">
          <div className="welcome-card-heading">
            <div>
              <span className="welcome-eyebrow">Version history</span>
              <h2>Latest snapshots</h2>
            </div>
            <button
              className="welcome-text-button"
              onClick={() => void clearSavedVaultHistory()}
              disabled={!nativeRuntime || historyLoading || historyItems.length === 0}
            >
              Clear history
            </button>
          </div>
          {historyError && <div className="welcome-history-error">{historyError}</div>}
          {historyLoading ? (
            <div className="welcome-empty">
              <strong>Loading version history</strong>
              <span>Checking saved vaults for page snapshots.</span>
            </div>
          ) : historyItems.length > 0 ? (
            <div className="welcome-history-list">
              {historyItems.map((item) => (
                <button
                  key={`${item.vaultPath}:${item.path}`}
                  className="welcome-history-row"
                  disabled={!nativeRuntime || !item.vaultPath}
                  onClick={() => item.vaultPath && onOpenRecent(item.vaultPath)}
                  title={item.path}
                >
                  <span>
                    <strong>{item.title || item.path}</strong>
                    <small>{item.vaultName ? `${item.vaultName} · ${item.path}` : item.path}</small>
                  </span>
                  <span>
                    <strong>{item.count}</strong>
                    <small>{historyTime(item.updatedAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="welcome-empty">
              <strong>No page versions yet</strong>
              <span>Rockion starts keeping snapshots after you edit a page.</span>
            </div>
          )}
        </section>

        <section className="welcome-card">
          <div className="welcome-card-heading">
            <div>
              <span className="welcome-eyebrow">Favorites</span>
              <h2>Pinned vaults</h2>
            </div>
            <span className="welcome-count">{pinned.length}</span>
          </div>
          {pinned.length > 0 ? (
            <div className="welcome-vault-list">
              {pinned.map((vault) => (
                <VaultRow
                  key={vault.path}
                  vault={vault}
                  nativeRuntime={nativeRuntime}
                  onOpen={() => onOpenRecent(vault.path)}
                  onTogglePinned={() => onTogglePinned(vault.path)}
                />
              ))}
            </div>
          ) : (
            <div className="welcome-empty">
              <strong>Keep important vaults close</strong>
              <span>Select the star beside a recent vault to pin it.</span>
            </div>
          )}
        </section>

        <section className="welcome-card">
          <span className="welcome-eyebrow">Getting started</span>
          <h2>Quick-start guide</h2>
          <ol className="welcome-guide">
            <li>Create a vault in a folder you control.</li>
            <li>Use the sidebar plus button to add a project.</li>
            <li>Open its dashboard and create pages from templates.</li>
            <li>Pin favorite pages and export encrypted backups regularly.</li>
          </ol>
        </section>

        <section className="welcome-card welcome-backup-card">
          <span className="welcome-eyebrow">Vault safety</span>
          <h2>Backup and import</h2>
          <p>
            Restore a password-protected <code>.rockion</code> archive. Export is
            available from Settings after opening a vault.
          </p>
          <button className="welcome-secondary" onClick={onImportVault} disabled={!nativeRuntime}>
            Import encrypted backup
          </button>
        </section>

        <section className="welcome-card welcome-stats-card">
          <span className="welcome-eyebrow">Local overview</span>
          <h2>App statistics</h2>
          <div className="welcome-stats">
            <div><strong>{stats.vaults}</strong><span>Vaults</span></div>
            <div><strong>{stats.projects}</strong><span>Projects</span></div>
            <div><strong>{stats.pages}</strong><span>Pages</span></div>
            <div><strong>{stats.favorites}</strong><span>Favorites</span></div>
          </div>
          <small>Counts refresh whenever a vault is opened.</small>
        </section>
      </div>
    </main>
  );
}
