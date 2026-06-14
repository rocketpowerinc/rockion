import type { VaultInfo } from "./api";

export interface SavedVault {
  path: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  pageCount: number;
  projectCount: number;
  favoriteCount: number;
}

export interface VaultStats {
  pageCount: number;
  projectCount: number;
  favoriteCount: number;
}

export interface VaultHistorySummary {
  vaults: number;
  pinned: number;
  pages: number;
  projects: number;
  favorites: number;
}

export const VAULT_HISTORY_KEY: string;
export function loadVaultHistory(storage?: Storage): SavedVault[];
export function saveVaultHistory(vaults: SavedVault[], storage?: Storage): void;
export function rememberVault(
  vaults: SavedVault[],
  info: VaultInfo,
  now?: number
): SavedVault[];
export function updateVaultStats(
  vaults: SavedVault[],
  path: string,
  stats: VaultStats
): SavedVault[];
export function toggleVaultPinned(
  vaults: SavedVault[],
  path: string
): SavedVault[];
export function summarizeVaultHistory(
  vaults: SavedVault[]
): VaultHistorySummary;
