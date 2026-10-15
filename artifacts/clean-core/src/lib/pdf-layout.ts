import bidiFactory from "bidi-js";
import type { Font } from "fontkit";
import type { PDFFont } from "pdf-lib";

const bidi = bidiFactory();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const controls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const joiner = /[\u200c\u200d]/;
const complex = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Oriya}]/u;

export interface PdfFontFace {
  pdf: PDFFont;
  source?: Font;
  supported: Set<number>;
}

/** Offsets refer to the original paragraph, so soft wrapping never resets bidi. */
export interface PdfLine {
  text: string;
  paragraph: string;
  start: number;
  end: number;
}

export function createPdfLayout(regular: PdfFontFace, bold: PdfFontFace, unicode: PdfFontFace, scripts: PdfFontFace[]) {
  function faceFor(segment: string, strong: boolean, previous?: PdfFontFace): PdfFontFace {
    if (/^[\x20-\x7e]+$/.test(segment)) return strong ? bold : regular;
    const characters = [...segment].filter(char => !joiner.test(char));
    const candidates = complex.test(segment) ? scripts
      : previous && scripts.includes(previous) ? [previous, unicode, ...scripts] : [unicode, ...scripts];
    const face = candidates.find(face => characters.every(char => face.supported.has(char.codePointAt(0)!)));
    if (!face) {
      const missing = characters.find(char => !candidates.some(face => face.supported.has(char.codePointAt(0)!))) || characters[0];
      throw new Error(`The PDF font does not support U+${missing.codePointAt(0)!.toString(16).toUpperCase()}. Download the Executive Summary or PowerPoint to retain this character`);
    }
    return face;
  }

  function layout(line: PdfLine, strong = false) {
    const embedding = bidi.getEmbeddingLevels(line.paragraph);
    const mirrored = bidi.getMirroredCharactersMap(line.paragraph, embedding.levels, line.start, line.end - 1);
    const runs: Array<{ text: string; face: PdfFontFace; level: number; start: number }> = [];
    for (const { segment, index } of graphemes.segment(line.text)) {
      const start = line.start + index;
      const visible = segment.replace(controls, "");
      if (!visible) continue;
      const level = embedding.levels[start];
      const face = faceFor(visible, strong, runs.at(-1)?.face);
      const mirroredText = [...visible].map((char, offset) => mirrored.get(start + offset) || char).join("");
      const last = runs.at(-1);
      if (last?.face === face && last.level === level) last.text += mirroredText;
      else runs.push({ text: mirroredText, face, level, start });
    }
    // UAX #9 line reordering; reorder runs, not the code points fed to shaping.
    const indices = Array.from({ length: line.paragraph.length }, (_, index) => index);
    for (const [start, end] of bidi.getReorderSegments(line.paragraph, embedding, line.start, line.end - 1)) {
      const reversed = indices.slice(start, end + 1).reverse();
      indices.splice(start, reversed.length, ...reversed);
    }
    const visualIndex = new Map(indices.map((logical, visual) => [logical, visual]));
    runs.sort((a, b) => visualIndex.get(a.start)! - visualIndex.get(b.start)!);
    return runs.map(run => {
      // Fontkit performs contextual substitution and mark positioning, including
      // Indic reordering. Its RTL shapers already return glyphs in visual order.
      const shape = () => {
        try { return run.face.source?.layout(run.text); }
        catch (error) { throw new Error("PDF text shaping failed. Please retry the download", { cause: error }); }
      };
      const shaped = shape();
      if ((run.level & 1) && shaped?.direction !== "rtl") {
        run.text = [...graphemes.segment(run.text)].map(part => part.segment).reverse().join("");
      }
      const glyphs = shape();
      const widthAtSize = (size: number) => glyphs
        ? glyphs.positions.reduce((sum, position) => sum + position.xAdvance, 0) * size / run.face.source!.unitsPerEm
        : run.face.pdf.widthOfTextAtSize(run.text, size);
      return { ...run, glyphs, widthAtSize };
    });
  }
  return layout;
}
