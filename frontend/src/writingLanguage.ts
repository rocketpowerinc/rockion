export type WritingLanguage = "en-US" | "fr-FR";

export function normalizeWritingLanguage(value: string | null): WritingLanguage {
  return value === "fr-FR" ? "fr-FR" : "en-US";
}

export function writingLanguageLabel(language: WritingLanguage): string {
  return language === "fr-FR" ? "French" : "English";
}
