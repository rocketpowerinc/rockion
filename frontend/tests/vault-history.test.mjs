import assert from "node:assert/strict";
import test from "node:test";
import {
  loadVaultHistory,
  rememberVault,
  saveVaultHistory,
  summarizeVaultHistory,
  toggleVaultPinned,
  updateVaultStats,
  VAULT_HISTORY_KEY,
} from "../src/vaultHistory.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("vault history remembers, pins, and updates local statistics", () => {
  let history = rememberVault([], { path: "C:/Vaults/Work", name: "Work" }, 100);
  history = updateVaultStats(history, "C:/Vaults/Work", {
    pageCount: 12,
    projectCount: 3,
    favoriteCount: 2,
  });
  history = toggleVaultPinned(history, "C:/Vaults/Work");

  assert.equal(history[0].pinned, true);
  assert.deepEqual(summarizeVaultHistory(history), {
    vaults: 1,
    pinned: 1,
    pages: 12,
    projects: 3,
    favorites: 2,
  });
});

test("vault history persists valid entries and ignores invalid storage", () => {
  const storage = memoryStorage();
  const history = rememberVault([], { path: "/vaults/personal", name: "Personal" }, 200);
  saveVaultHistory(history, storage);

  assert.equal(loadVaultHistory(storage)[0].name, "Personal");
  storage.setItem(VAULT_HISTORY_KEY, "{not json");
  assert.deepEqual(loadVaultHistory(storage), []);
});

test("reopening a vault preserves its pin and moves it to the front", () => {
  let history = rememberVault([], { path: "/one", name: "One" }, 100);
  history = toggleVaultPinned(history, "/one");
  history = rememberVault(history, { path: "/two", name: "Two" }, 200);
  history = rememberVault(history, { path: "/one", name: "One renamed" }, 300);

  assert.equal(history[0].path, "/one");
  assert.equal(history[0].name, "One renamed");
  assert.equal(history[0].pinned, true);
});
