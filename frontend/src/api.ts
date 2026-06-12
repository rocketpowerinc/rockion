// Thin, typed wrapper over the Wails-generated Go bindings.
//
// The files under ./wailsjs are generated automatically by `wails dev` / `wails build`
// (and `wails generate module`). They will not exist until you run Wails once.
import * as App from "../wailsjs/go/main/App";
import { BrowserOpenURL, EventsOn } from "../wailsjs/runtime/runtime";

export interface VaultInfo {
  path: string;
  name: string;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  icon?: string;
  children?: TreeNode[];
}

export interface Note {
  path: string;
  title: string;
  icon?: string;
  markdown: string;
  frontmatter?: Record<string, unknown>;
  modifiedAt: number;
  version: string;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet?: string;
}

export const api = {
  pickVault: (): Promise<VaultInfo> => App.PickVault(),
  openVault: (path: string): Promise<VaultInfo> => App.OpenVault(path),
  listTree: (): Promise<TreeNode[]> => App.ListTree(),
  readNote: (path: string): Promise<Note> => App.ReadNote(path),
  writeNote: (path: string, markdown: string, expectedVersion: string): Promise<Note> =>
    App.WriteNote(path, markdown, expectedVersion),
  createNote: (dir: string, title: string): Promise<Note> => App.CreateNote(dir, title),
  renamePath: (oldPath: string, newPath: string): Promise<void> => App.RenamePath(oldPath, newPath),
  deletePath: (path: string): Promise<void> => App.DeletePath(path),
  search: (query: string, limit = 50): Promise<SearchHit[]> => App.Search(query, limit),
  backlinks: (path: string): Promise<SearchHit[]> => App.Backlinks(path),
  // SaveImage takes a Go []byte; Wails marshals a number[] / base64. We pass an array.
  saveImage: (name: string, data: number[]): Promise<string> => App.SaveImage(name, data),
  // SaveFile opens a native save dialog and writes content; returns chosen path ("" if cancelled).
  saveFile: (name: string, content: string): Promise<string> => App.SaveFile(name, content),
  // SetNoteIcon stores an emoji icon for a note ("" clears it).
  setNoteIcon: (path: string, icon: string): Promise<void> => App.SetNoteIcon(path, icon),
  openExternal: (url: string): void => BrowserOpenURL(url),
  confirmClose: (): Promise<void> => App.ConfirmClose(),
};

export const onVaultChanged = (cb: (path: string) => void) =>
  EventsOn("vault:changed", cb);

export const onIndexReady = (cb: () => void) => EventsOn("index:ready", cb);
export const onBeforeClose = (cb: () => void) => EventsOn("app:before-close", cb);
