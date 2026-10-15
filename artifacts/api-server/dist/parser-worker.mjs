import { fromBuffer } from "yauzl";
import { XMLParser } from "fast-xml-parser";

const MAX_TEXT = 400_000;
const passages = [];
let total = 0;
function add(section, value) {
  const text = value.replace(/\0/g, "").trim();
  total += text.length;
  if (total > MAX_TEXT) throw new Error("Extracted text exceeds 400,000 characters.");
  for (let i = 0; i < text.length; i += 1400) {
    const chunk = text.slice(i, i + 1400).trim();
    if (chunk) passages.push({ section: section.slice(0, 160), text: chunk });
  }
}
function docxXml(buffer) {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(new Error("Invalid DOCX ZIP archive."));
      let expanded = 0, count = 0, xml = null;
      const fail = (message) => { zip.close(); reject(new Error(message)); };
      zip.on("error", () => fail("Corrupt DOCX archive."));
      zip.on("entry", entry => {
        expanded += entry.uncompressedSize;
        if (++count > 500 || expanded > 32_000_000 || entry.uncompressedSize > 8_000_000)
          return fail("DOCX decompression limit exceeded.");
        if (entry.generalPurposeBitFlag & 1) return fail("Encrypted DOCX files are unsupported.");
        if (entry.fileName !== "word/document.xml") { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail("Cannot extract DOCX text.");
          const pieces = []; let size = 0;
          stream.on("data", chunk => {
            size += chunk.length;
            if (size > 8_000_000) { stream.destroy(); fail("DOCX text limit exceeded."); }
            else pieces.push(chunk);
          });
          stream.on("error", () => fail("Corrupt DOCX text."));
          stream.on("end", () => { xml = Buffer.concat(pieces).toString("utf8"); zip.readEntry(); });
        });
      });
      zip.on("end", () => xml ? resolve(xml) : reject(new Error("Not a DOCX document.")));
      zip.readEntry();
    });
  });
}
async function parse(buffer, ext) {
  if (ext === "pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF signature does not match the file type.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWasm: false, stopAtErrors: true });
    task.onPassword = () => { task.destroy(); };
    let pdf;
    try { pdf = await task.promise; } catch { throw new Error("Invalid or encrypted PDF. Upload an unencrypted text PDF."); }
    try {
      if (pdf.numPages > 200) throw new Error("PDF exceeds the 200-page limit.");
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page);
        const content = await p.getTextContent();
        add(`Page ${page}`, content.items.map(i => i.str || "").join(" "));
        p.cleanup();
      }
    } finally { await task.destroy(); }
  } else if (ext === "docx") {
    if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("DOCX signature invalid or file encrypted.");
    if (buffer.length >= 8 && (buffer.readUInt16LE(6) & 1)) throw new Error("Encrypted DOCX files are unsupported.");
    const xml = await docxXml(buffer);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are unsupported.");
    const parsed = new XMLParser({ ignoreAttributes: true, preserveOrder: true, processEntities: false }).parse(xml);
    const paragraphs = [];
    const textOf = node => typeof node === "string" || typeof node === "number" ? String(node)
      : Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? Object.values(node).map(textOf).join("") : "";
    const walk = node => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") for (const [key, val] of Object.entries(node)) {
        if (key === "w:p") paragraphs.push(textOf(val)); else walk(val);
      }
    };
    walk(parsed);
    paragraphs.forEach((p, i) => add(`Paragraph ${i + 1}`, p));
  } else {
    if (buffer.subarray(0, 5).toString() === "%PDF-" || buffer.subarray(0, 2).toString() === "PK")
      throw new Error("File signature does not match a plain-text document.");
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new Error("Text guidance must be UTF-8."); }
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error("Binary data is not a text document.");
    let section = "Text";
    for (const paragraph of text.split(/\n\s*\n/)) {
      const heading = /^#{1,6}\s+(.+)/m.exec(paragraph);
      if (heading) section = heading[1];
      add(section, paragraph);
    }
  }
  if (total < 30 || !passages.some(p => /[\p{L}]{3}/u.test(p.text))) throw new Error("No usable text found. Scanned/textless documents require OCR before upload; OCR is not provided.");
  if (passages.length > 600) throw new Error("Document has too many passages (maximum 600).");
  return passages;
}
process.once("message", async ({ bytes, ext }) => {
  try { process.send({ passages: await parse(Buffer.from(bytes, "base64"), ext) }); }
  catch (e) { process.send({ error: e.message || "Document parsing failed." }); }
  finally { process.disconnect(); }
});
