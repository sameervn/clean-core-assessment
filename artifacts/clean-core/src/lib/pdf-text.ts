import { createFont, pdfFontkit } from "./pdf-fontkit";
import {
  StandardFonts, PDFHexString, PDFName, PDFOperator, PDFOperatorNames,
  beginText, endText, pushGraphicsState, popGraphicsState, setFillingRgbColor,
  setFontAndSize, setTextMatrix, showText,
  type PDFDocument, type PDFPage, type RGB,
} from "pdf-lib";
import { createPdfLayout, type PdfFontFace, type PdfLine } from "./pdf-layout";

/** Fonts are supplied by the lazy PDF export, never loaded at application startup. */
export async function createPdfText(document: PDFDocument, unicodeBytes: Uint8Array, scriptBytes: Uint8Array[] = []) {
  document.registerFontkit(pdfFontkit);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const unicode = await document.embedFont(unicodeBytes, { subset: true });
  const scripts: PdfFontFace[] = await Promise.all(scriptBytes.map(async bytes => {
    const pdf = await document.embedFont(bytes, { subset: true });
    return { pdf, source: createFont(bytes), supported: new Set(pdf.getCharacterSet()) };
  }));
  const layout = createPdfLayout(
    { pdf: regular, supported: new Set(regular.getCharacterSet()) },
    { pdf: bold, supported: new Set(bold.getCharacterSet()) },
    { pdf: unicode, source: createFont(unicodeBytes), supported: new Set(unicode.getCharacterSet()) },
    scripts,
  );
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  // Normalize only the export copy. Stored explanations and identifiers are untouched.
  const text = (value: unknown) => String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  function standalone(value: string): PdfLine {
    return { text: value, paragraph: value, start: 0, end: value.length };
  }
  function width(value: string, size: number, strong = false) {
    return layout(standalone(text(value)), strong).reduce((sum, run) => sum + run.widthAtSize(size), 0);
  }
  function wrapLines(value: unknown, maxWidth: number, size: number, strong = false): PdfLine[] {
    const lines: PdfLine[] = [];
    for (const paragraph of text(value).split("\n")) {
      let start = 0;
      let line = "";
      const emit = (content: string, consumed = content.length) => {
        lines.push({ text: content, paragraph, start, end: start + content.length });
        start += consumed;
      };
      for (const { segment } of segmenter.segment(paragraph)) {
        if (width(segment, size, strong) > maxWidth) throw new Error("PDF text area is too narrow");
        if (line && width(line + segment, size, strong) > maxWidth) {
          const breakAt = line.lastIndexOf(" ");
          if (breakAt > 0 && segment !== " ") {
            emit(line.slice(0, breakAt), breakAt + 1);
            line = line.slice(breakAt + 1);
          } else {
            emit(line);
            line = "";
          }
          // A long identifier or a CJK paragraph may have no word boundary.
          if (line && width(line + segment, size, strong) > maxWidth) {
            emit(line);
            line = "";
          }
        }
        line += segment;
      }
      emit(line);
    }
    return lines;
  }
  function wrap(value: unknown, maxWidth: number, size: number, strong = false): string[] {
    return wrapLines(value, maxWidth, size, strong).map(line => line.text);
  }
  function drawLine(page: PDFPage, line: PdfLine, options: { x: number; y: number; size: number; strong?: boolean; color?: RGB }) {
    if (!line.text) return;
    const runs = layout(line, options.strong);
    // ActualText preserves logical Unicode independently of ligatures, visual
    // glyph order and repeated mark glyphs in the subset's ToUnicode mapping.
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of("Span"),
      document.context.obj({ ActualText: PDFHexString.fromText(line.text) }).toString(),
    ]), pushGraphicsState());
    const color = options.color;
    page.pushOperators(setFillingRgbColor(color?.red ?? 0, color?.green ?? 0, color?.blue ?? 0), beginText());
    let x = options.x;
    for (const run of runs) {
      const font = run.face.pdf;
      const key = page.node.newFontDictionary(font.name, font.ref);
      page.pushOperators(setFontAndSize(key, options.size));
      if (!run.glyphs) {
        page.pushOperators(setTextMatrix(1, 0, 0, 1, x, options.y), showText(font.encodeText(run.text)));
      } else {
        const encoded = font.encodeText(run.text).asString();
        if (encoded.length !== run.glyphs.glyphs.length * 4) throw new Error("PDF glyph encoding mismatch");
        const scale = options.size / run.face.source!.unitsPerEm;
        let penX = x;
        let penY = options.y;
        run.glyphs.positions.forEach((position, index) => {
          page.pushOperators(
            setTextMatrix(1, 0, 0, 1, penX + position.xOffset * scale, penY + position.yOffset * scale),
            showText(PDFHexString.of(encoded.slice(index * 4, index * 4 + 4))),
          );
          penX += position.xAdvance * scale;
          penY += position.yAdvance * scale;
        });
      }
      x += run.widthAtSize(options.size);
    }
    page.pushOperators(endText(), popGraphicsState(), PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  }
  function draw(page: PDFPage, value: unknown, options: Parameters<typeof drawLine>[2]) {
    drawLine(page, standalone(text(value)), options);
  }
  function appendix(entries: readonly string[]) {
    for (const entry of entries) {
      const lines = wrapLines(entry, 750, 10);
      for (let offset = 0; offset < lines.length; offset += 32) {
        const page = document.addPage([842, 595]);
        draw(page, `Accepted AI explanation - not deterministic assessment${offset ? " (continued)" : ""}`, { x: 46, y: 550, size: 16, strong: true });
        lines.slice(offset, offset + 32).forEach((line, index) => {
          drawLine(page, line, { x: 46, y: 510 - index * 14, size: 10 });
        });
      }
    }
  }
  return { regular, bold, text, width, wrap, wrapLines, draw, drawLine, appendix };
}
