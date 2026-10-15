import * as hb from "harfbuzzjs";
import { unzlibSync } from "fflate";
import type { Font, GlyphRun } from "fontkit";

/** Reconstruct the sfnt table directory from WOFF1 for HarfBuzz. */
function sfnt(bytes: Uint8Array): ArrayBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x774f4646) return bytes.slice().buffer;
  const count = view.getUint16(12);
  const output = new Uint8Array(view.getUint32(16));
  const header = new DataView(output.buffer);
  header.setUint32(0, view.getUint32(4));
  header.setUint16(4, count);
  const power = Math.floor(Math.log2(count));
  header.setUint16(6, 16 * 2 ** power);
  header.setUint16(8, power);
  header.setUint16(10, count * 16 - 16 * 2 ** power);
  let offset = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const input = 44 + i * 20;
    const entry = 12 + i * 16;
    const start = view.getUint32(input + 4);
    const compressed = view.getUint32(input + 8);
    const length = view.getUint32(input + 12);
    const data = bytes.subarray(start, start + compressed);
    output.set(compressed === length ? data : unzlibSync(data), offset);
    header.setUint32(entry, view.getUint32(input));
    header.setUint32(entry + 4, view.getUint32(input + 16));
    header.setUint32(entry + 8, offset);
    header.setUint32(entry + 12, length);
    offset += (length + 3) & ~3;
  }
  return output.buffer;
}

/** Both measuring and PDF encoding use the same HarfBuzz glyph sequence. */
export function installShaper(font: Font, bytes: Uint8Array) {
  const face = new hb.Face(new hb.Blob(sfnt(bytes)));
  const hbFont = new hb.Font(face);
  const cache = new Map<string, GlyphRun>();
  font.layout = (text: string) => {
    const cached = cache.get(text);
    if (cached) return cached;
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(hbFont, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const boundaries = [...new Set(infos.map(info => info.cluster)), text.length].sort((a, b) => a - b);
    const run = {
      // Retain a ToUnicode fallback for readers which ignore ActualText.
      // HarfBuzz clusters are UTF-16 offsets, matching JavaScript slicing.
      glyphs: infos.map(info => font.getGlyph(info.codepoint, [
        ...text.slice(info.cluster, boundaries[boundaries.indexOf(info.cluster) + 1]),
      ].map(character => character.codePointAt(0)!))),
      positions,
      direction: /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text) ? "rtl" : "ltr",
      advanceWidth: positions.reduce((sum, position) => sum + position.xAdvance, 0),
      advanceHeight: 0,
    } as GlyphRun;
    if (cache.size > 2048) cache.clear();
    cache.set(text, run);
    return run;
  };
}
