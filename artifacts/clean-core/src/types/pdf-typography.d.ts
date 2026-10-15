declare module "bidi-js" {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderSegments(text: string, levels: EmbeddingLevels, start?: number, end?: number): Array<[number, number]>;
    getMirroredCharactersMap(text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>;
  };
}
