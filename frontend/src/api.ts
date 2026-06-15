// Thin, typed wrapper over the Wails-generated Go bindings.
//
// The files under ./wailsjs are generated automatically by `wails dev` / `wails build`
// (and `wails generate module`). They will not exist until you run Wails once.
import * as App from "../wailsjs/go/main/App";
import {
  BrowserOpenURL,
  EventsOn,
  WindowSetDarkTheme,
  WindowSetLightTheme,
} from "../wailsjs/runtime/runtime";
import { hasWailsRuntime } from "./runtimeBridge.mjs";

export interface VaultInfo {
  path: string;
  name: string;
}

export interface TreeNode {
  name: string;
  path: string;
  entryPath?: string;
  isDir: boolean;
  icon?: string;
  children?: TreeNode[];
}

export interface Note {
  path: string;
  title: string;
  pageId?: string;
  tag?: string;
  tagColor?: string;
  icon?: string;
  cover?: PageCover;
  markdown: string;
  frontmatter?: Record<string, unknown>;
  createdAt: number;
  modifiedAt: number;
  version: string;
}

export interface PageCover {
  kind: string;
  value: string;
  position: number;
}

export interface PageCard {
  pageId: string;
  path: string;
  title: string;
  tag: string;
  tagColor: string;
  icon?: string;
  cover?: PageCover;
  createdAt: number;
  modifiedAt: number;
}

export interface DashboardView {
  view: string; // gallery | list
  sortBy?: string;
  sortDir?: string;
}

export interface PageTemplate {
  id: string;
  label: string;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet?: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  canAutoUpdate: boolean;
  platform: string;
  architecture: string;
  installMode: string;
  assetName: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  message: string;
}

export const api = {
  isNativeRuntime: (): boolean => hasWailsRuntime(),
  pickVault: (): Promise<VaultInfo> => App.PickVault(),
  createVault: (name: string): Promise<VaultInfo> => App.CreateVault(name),
  closeVault: (): Promise<void> => App.CloseVault(),
  openVault: (path: string): Promise<VaultInfo> => App.OpenVault(path),
  listTree: (): Promise<TreeNode[]> => App.ListTree(),
  listPages: (): Promise<TreeNode[]> => App.ListPages(),
  listFavorites: (): Promise<TreeNode[]> => App.ListFavorites(),
  setFavorite: (path: string, favorite: boolean): Promise<void> =>
    App.SetFavorite(path, favorite),
  reorderFavorites: (paths: string[]): Promise<void> => App.ReorderFavorites(paths),
  readNote: (path: string): Promise<Note> => App.ReadNote(path),
  writeNote: (path: string, markdown: string, expectedVersion: string): Promise<Note> =>
    App.WriteNote(path, markdown, expectedVersion),
  createSubPage: (dashboardPath: string, title: string): Promise<Note> =>
    App.CreateSubPage(dashboardPath, title),
  createSubPageFromTemplate: (
    dashboardPath: string,
    title: string,
    template: string
  ): Promise<Note> => App.CreateSubPageFromTemplate(dashboardPath, title, template),
  createProject: (title: string): Promise<Note> => App.CreateProject(title),
  renamePath: (oldPath: string, newPath: string): Promise<void> => App.RenamePath(oldPath, newPath),
  renameProject: (dashboardPath: string, title: string): Promise<Note> =>
    App.RenameProject(dashboardPath, title),
  // Rename a note so its filename matches its title (first H1); returns the moved note.
  renameToTitle: (path: string, title: string): Promise<Note> => App.RenameToTitle(path, title),
  deletePath: (path: string): Promise<void> => App.DeletePath(path),
  // Dashboard "database" views.
  listDashboardCards: (dashboardPath: string): Promise<PageCard[]> =>
    App.ListDashboardCards(dashboardPath),
  listPageTemplates: (): Promise<PageTemplate[]> => App.ListPageTemplates(),
  getDashboardView: (dashboardPath: string): Promise<DashboardView> =>
    App.GetDashboardView(dashboardPath),
  setDashboardView: (dashboardPath: string, view: DashboardView): Promise<void> =>
    App.SetDashboardView(dashboardPath, view),
  reorderManagedPages: (dashboardPath: string, pageIds: string[]): Promise<void> =>
    App.ReorderManagedPages(dashboardPath, pageIds),
  deleteManagedPage: (
    dashboardPath: string,
    href: string,
    expectedVersion: string
  ): Promise<Note> => App.DeleteManagedPage(dashboardPath, href, expectedVersion),
  search: (query: string, limit = 50): Promise<SearchHit[]> => App.Search(query, limit),
  backlinks: (path: string): Promise<SearchHit[]> => App.Backlinks(path),
  // SaveImage takes a Go []byte; Wails marshals a number[] / base64. We pass an array.
  saveImage: (name: string, data: number[]): Promise<string> => App.SaveImage(name, data),
  setNoteCover: (path: string, cover: PageCover): Promise<Note> =>
    App.SetNoteCover(path, cover),
  coverImageDataURL: (path: string): Promise<string> => App.CoverImageDataURL(path),
  coverThumbnailDataURL: (path: string): Promise<string> =>
    App.CoverThumbnailDataURL(path),
  // SaveFile opens a native save dialog and writes content; returns chosen path ("" if cancelled).
  saveFile: (name: string, content: string): Promise<string> => App.SaveFile(name, content),
  exportVault: (password: string): Promise<string> => App.ExportVault(password),
  pickVaultImportArchive: (): Promise<string> => App.PickVaultImportArchive(),
  importVault: (archivePath: string, password: string): Promise<VaultInfo> =>
    App.ImportVault(archivePath, password),
  // SetNoteIcon stores an emoji icon for a note ("" clears it).
  setNoteIcon: (path: string, icon: string): Promise<void> => App.SetNoteIcon(path, icon),
  checkForUpdates: (): Promise<UpdateInfo> => App.CheckForUpdates(),
  installUpdate: (): Promise<UpdateInfo> => App.InstallUpdate(),
  openExternal: (url: string): void => {
    if (hasWailsRuntime()) {
      BrowserOpenURL(url);
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  },
  setWindowTheme: (theme: "light" | "dark"): void => {
    if (!hasWailsRuntime()) return;
    theme === "dark" ? WindowSetDarkTheme() : WindowSetLightTheme();
  },
  confirmClose: (): Promise<void> => App.ConfirmClose(),
};

export const onVaultChanged = (cb: (path: string) => void) =>
  hasWailsRuntime() ? EventsOn("vault:changed", cb) : () => {};

export const onIndexReady = (cb: () => void) =>
  hasWailsRuntime() ? EventsOn("index:ready", cb) : () => {};
export const onBeforeClose = (cb: () => void) =>
  hasWailsRuntime() ? EventsOn("app:before-close", cb) : () => {};
