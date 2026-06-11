// Thin, typed wrapper over the Wails-generated Go bindings.
//
// The files under ./wailsjs are generated automatically by `wails dev` / `wails build`
// (and `wails generate module`). They will not exist until you run Wails once.
import * as App from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";

export interface VaultInfo {
  path: string;
  name: string;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export interface Note {
  path: string;
  title: string;
  markdown: string;
  frontmatter?: Record<string, unknown>;
  modifiedAt: number;
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
  writeNote: (path: string, markdown: string): Promise<void> => App.WriteNote(path, markdown),
  createNote: (dir: string, title: string): Promise<Note> => App.CreateNote(dir, title),
  renamePath: (oldPath: string, newPath: string): Promise<void> => App.RenamePath(oldPath, newPath),
  deletePath: (path: string): Promise<void> => App.DeletePath(path),
  search: (query: string, limit = 50): Promise<SearchHit[]> => App.Search(query, limit),
  backlinks: (path: string): Promise<SearchHit[]> => App.Backlinks(path),
  // SaveImage takes a Go []byte; Wails marshals a number[] / base64. We pass an array.
  saveImage: (name: string, data: number[]): Promise<string> => App.SaveImage(name, data),
};

export const onVaultChanged = (cb: (path: string) => void) =>
  EventsOn("vault:changed", cb);

export const onIndexReady = (cb: () => void) => EventsOn("index:ready", cb);
