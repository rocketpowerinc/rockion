interface SlashSearchItem {
  title: string;
  hint: string;
  aliases?: string[];
}

export function normalizeSlashSearch(value: string): string;
export function matchesSlashSearch(
  item: SlashSearchItem,
  query: string
): boolean;
