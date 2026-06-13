const navigationKeys = new Set(["ArrowUp", "ArrowDown", "Enter"]);

export function shouldHandleSlashMenuKey(key, itemCount) {
  return itemCount > 0 && navigationKeys.has(key);
}
