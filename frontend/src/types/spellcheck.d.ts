declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }

  interface Dictionary {
    aff: string | Uint8Array;
    dic: string | Uint8Array;
  }

  export default function nspell(dictionary: Dictionary): NSpell;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*?url" {
  const url: string;
  export default url;
}
