export const VAULT_HISTORY_KEY = "rockion-vault-history-v1";
const MAX_VAULTS = 20;

function isSavedVault(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.path === "string" &&
    value.path.trim() !== "" &&
    typeof value.name === "string" &&
    value.name.trim() !== ""
  );
}

export function loadVaultHistory(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(VAULT_HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedVault)
      .map((vault) => ({
        path: vault.path,
        name: vault.name,
        lastOpened: Number.isFinite(vault.lastOpened) ? vault.lastOpened : 0,
        pinned: vault.pinned === true,
        pageCount: Math.max(0, Number(vault.pageCount) || 0),
        projectCount: Math.max(0, Number(vault.projectCount) || 0),
        favoriteCount: Math.max(0, Number(vault.favoriteCount) || 0),
      }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened)
      .slice(0, MAX_VAULTS);
  } catch {
    return [];
  }
}

export function saveVaultHistory(vaults, storage = globalThis.localStorage) {
  try {
    storage?.setItem(VAULT_HISTORY_KEY, JSON.stringify(vaults.slice(0, MAX_VAULTS)));
  } catch {
    // History is optional when browser storage is unavailable.
  }
}

export function rememberVault(vaults, info, now = Date.now()) {
  const existing = vaults.find((vault) => vault.path === info.path);
  return [
    {
      path: info.path,
      name: info.name,
      lastOpened: now,
      pinned: existing?.pinned === true,
      pageCount: existing?.pageCount || 0,
      projectCount: existing?.projectCount || 0,
      favoriteCount: existing?.favoriteCount || 0,
    },
    ...vaults.filter((vault) => vault.path !== info.path),
  ]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened)
    .slice(0, MAX_VAULTS);
}

export function updateVaultStats(vaults, path, stats) {
  return vaults.map((vault) =>
    vault.path === path
      ? {
          ...vault,
          pageCount: Math.max(0, Number(stats.pageCount) || 0),
          projectCount: Math.max(0, Number(stats.projectCount) || 0),
          favoriteCount: Math.max(0, Number(stats.favoriteCount) || 0),
        }
      : vault
  );
}

export function toggleVaultPinned(vaults, path) {
  return vaults
    .map((vault) =>
      vault.path === path ? { ...vault, pinned: !vault.pinned } : vault
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened);
}

export function summarizeVaultHistory(vaults) {
  return vaults.reduce(
    (summary, vault) => ({
      vaults: summary.vaults + 1,
      pinned: summary.pinned + Number(vault.pinned),
      pages: summary.pages + vault.pageCount,
      projects: summary.projects + vault.projectCount,
      favorites: summary.favorites + vault.favoriteCount,
    }),
    { vaults: 0, pinned: 0, pages: 0, projects: 0, favorites: 0 }
  );
}
