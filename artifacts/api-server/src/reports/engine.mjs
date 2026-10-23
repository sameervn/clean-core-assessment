import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { fromBuffer } from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { posix } from "node:path";
import { fields, rowFields } from "./contract.mjs";
import { SaxesParser } from "saxes";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, removeNSPrefix: true });
const array = value => value ? (Array.isArray(value) ? value : [value]) : [];
const fail = message => { throw new Error(message); };

// Inspect every entry before PizZip/Docxtemplater allocate the archive.
export function inspectArchive(bytes) {
  if (!Buffer.isBuffer(bytes)) fail("DOCX must be binary Buffer data.");
  if (bytes.length > 4_000_000 || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) fail("Use an unencrypted DOCX ZIP smaller than 4 MB.");
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("Corrupt DOCX ZIP."));
      const entries = new Map(); let count = 0, expanded = 0;
      const stop = e => { zip.close(); reject(e instanceof Error ? e : new Error(String(e))); };
      zip.on("error", stop);
      zip.on("entry", entry => {
        const name = entry.fileName;
        const offset = entry.relativeOffsetOfLocalHeader;
        if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50
          || bytes.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag
          || bytes.readUInt16LE(offset + 8) !== entry.compressionMethod) return stop("Corrupt or encrypted DOCX local header.");
        expanded += entry.uncompressedSize;
        if (++count > 300 || expanded > 20_000_000 || entry.uncompressedSize > 8_000_000) return stop("DOCX archive complexity/expanded size limit exceeded.");
        if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) return stop("Encrypted or unsupported compressed entries.");
        if (entries.has(name) || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) return stop("Duplicate or unsafe archive path.");
        if (name.endsWith("/")) { entries.set(name, Buffer.alloc(0)); zip.readEntry(); return; }
        if (!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:core|app)\.xml|word\/(?:document|styles|stylesWithEffects|settings|webSettings|fontTable|numbering|footnotes|endnotes|header\d+|footer\d+)\.xml|word\/theme\/theme\d+\.xml|word\/_rels\/[^/]+\.rels|word\/media\/[^/]+\.(?:png|jpe?g))$/.test(name))
          return stop(`Unsupported DOCX part: ${name}. Remove embedded/active/custom content.`);
        if (/\.(xml|rels)$/.test(name) && entry.uncompressedSize > 2_000_000) return stop("XML part exceeds 2 MB.");
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return stop("Corrupt DOCX entry.");
          const chunks = []; let size = 0;
          stream.on("error", stop);
          stream.on("data", c => { size += c.length; if (size > entry.uncompressedSize || size > 8_000_000) { stream.destroy(); stop("Expanded entry size mismatch."); } else chunks.push(c); });
          stream.on("end", () => { entries.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.readEntry();
    });
  });
}

export async function validate(bytes) {
  const entries = await inspectArchive(bytes);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) if (!entries.has(name)) fail(`Missing required OpenXML part: ${name}.`);
  for (const [name, data] of entries) {
    if (!/\.(xml|rels)$/.test(name)) {
      if (/\.(png|jpe?g)$/.test(name) && !(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.subarray(0,3).equals(Buffer.from([255,216,255])))) fail("Embedded images must be actual PNG or JPEG.");
      continue;
    }
    let xml;
    try { xml = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { fail("OpenXML must be UTF-8."); }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) fail(`Invalid/unsafe XML in ${name}.`);
    if (/macroEnabled|vbaProject|oleObject|activeX|altChunk|attachedTemplate/i.test(xml)) fail("Macros, active content and embedded objects are not supported.");
    if (/urn:schemas-microsoft-com:vml|<(?:\w+:)?(?:script|pict|imagedata)\b|(?:\s|:)(?:src|href)\s*=/i.test(xml)) fail("VML, scripts and linked content are unsupported. Use embedded PNG/JPEG DrawingML images.");
    if (name.startsWith("word/") && /<(?:\w+:)?(?:fldChar|instrText|fldSimple|object|control|sdt|ins|del|customXml|subDoc)\b/.test(xml)) fail("Remove Word fields, content controls, tracked changes and embedded content.");
    if (name.endsWith(".rels")) {
      const rels = array(parser.parse(xml)?.Relationships?.Relationship);
      for (const rel of rels) {
        const target = rel["@_Target"], type = rel["@_Type"];
        if (rel["@_TargetMode"] || typeof target !== "string" || /[:\\%?#]/.test(target) || target.startsWith("/")) fail("External or unsafe relationships are not supported; embed images and remove links.");
        if (!/^http:\/\/schemas\.openxmlformats\.org\/(?:officeDocument\/2006\/relationships\/(?:officeDocument|styles|stylesWithEffects|settings|webSettings|fontTable|numbering|theme|footnotes|endnotes|header|footer|image|extended-properties)|package\/2006\/relationships\/metadata\/core-properties)$/.test(type)) fail("Unsupported relationship type.");
        const base = name === "_rels/.rels" ? "" : posix.dirname(posix.dirname(name));
        if (!entries.has(posix.normalize(posix.join(base, target)))) fail(`Missing relationship target: ${target}.`);
      }
    }
  }
  const content = parser.parse(entries.get("[Content_Types].xml").toString());
  if (!array(content?.Types?.Override).some(x => x["@_PartName"] === "/word/document.xml" && x["@_ContentType"] === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) fail("Not a standard Word DOCX document.");
  const document = entries.get("word/document.xml").toString();
  const rootParser = new SaxesParser({ xmlns: true });
  let rootSeen = false;
  rootParser.on("doctype", () => fail("DTD is unsupported."));
  rootParser.on("opentag", tag => {
    if (!rootSeen) {
      rootSeen = true;
      if (tag.local !== "document" || tag.prefix !== "w" || tag.uri !== W) fail("Use standard WordprocessingML with the w namespace.");
    }
    // Reject namespace rebinding in descendants as well.
    if (tag.prefix === "w" && tag.uri !== W) fail("Invalid WordprocessingML namespace.");
    if (Object.hasOwn(tag.ns, "w") && tag.ns.w !== W) fail("Invalid WordprocessingML namespace.");
  });
  rootParser.write(document).close();
  if (!rootSeen) fail("Missing document root.");
  // CRC integrity check on every part, including images.
  const zip = new PizZip(bytes, { checkCRC32: true });
  const tags = new Set(); let count = 0;
  const doc = compile(zip, tag => {
    if (++count > 1000) fail("Template has more than 1,000 tags.");
    tags.add(tag);
    if (!fields.includes(tag) && !Object.hasOwn(rowFields, tag) && !["text"].includes(tag)) fail(`Unknown tag {${tag}}. Use the placeholder reference; expressions are not supported.`);
  });
  for (const required of ["entity_id", "entity_kind"]) if (!tags.has(required)) fail(`Add required placeholder {${required}} to the document.`);
  // Validate loop scope on Docxtemplater's compiled tokens, not a regex over Word runs.
  const walk = (tokens, scope = null) => {
    for (const token of tokens) {
      if (token.type !== "placeholder") continue;
      if (token.module === "loop") {
        if (scope || !Object.hasOwn(rowFields, token.value) || token.inverted) fail("Only non-nested findings/recommendations loops are supported.");
        walk(token.subparsed, token.value);
      } else if (token.module || (scope ? !rowFields[scope].includes(token.value) && !fields.includes(token.value) : !fields.includes(token.value))) fail(`Invalid placeholder {${token.value}} in this scope.`);
    }
  };
  for (const part of Object.values(doc.compiled)) walk(part.postparsed);
  return bytes;
}

function compile(zip, onTag = () => {}) {
  try {
    return new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true, errorLogging: false,
      parser(tag) {
        onTag(tag);
        return { get(scope) { return scope && Object.hasOwn(scope, tag) ? scope[tag] : undefined; } };
      },
      nullGetter: () => "Not provided",
    });
  } catch (e) {
    const details = e.properties?.errors?.map(x => x.properties?.explanation || x.message).join("; ");
    throw new Error(details || e.message || "Malformed placeholders or loops.");
  }
}

export function render(bytes, data) {
  const doc = compile(new PizZip(bytes));
  doc.render(data); // Plain strings only: values are XML-escaped, never parsed as tags.
  let expanded = 0;
  for (const file of Object.values(doc.getZip().files)) {
    if (!file.dir) expanded += file.asUint8Array().length;
    if (expanded > 20_000_000) fail("Populated DOCX exceeds 20 MB expanded. Simplify repeated sections.");
  }
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export function sample() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body>${paragraph("Clean Core — sample report template")}${fields.map(f => paragraph(`${f.replaceAll("_", " ")}: {${f}}`)).join("")}<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="7000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${paragraph("{#findings}{text}")}</w:tc><w:tc>${paragraph("{severity}{/findings}")}</w:tc></w:tr></w:tbl>${paragraph("{#recommendations}{text}{/recommendations}")}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function run({ bytes, mode, entities }) {
  const template = bytes ? Buffer.from(bytes, "base64") : sample();
  await validate(template);
  if (mode === "validate") return Buffer.alloc(0);
  if (mode === "sample") return template;
  const zip = new PizZip(); let total = 0;
  const unique = new Map();
  for (const entity of entities) {
    const prev = unique.get(entity.entity_id);
    if (!prev || entity.entity_kind === "interface") unique.set(entity.entity_id, entity);
  }
  const values = [...unique.values()];
  for (const [i, entity] of values.entries()) {
    const result = render(template, entity);
    total += result.length;
    if (total > 40_000_000) fail("Reports exceed 40 MB. Select fewer entities.");
    if (values.length === 1) return result;
    const name = entity.entity_id.normalize("NFKD").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70) || "entity";
    zip.file(`${String(i + 1).padStart(3, "0")}-${entity.entity_kind}-${name}.docx`, result);
  }
  return zip.generate({ type: "nodebuffer", compression: "STORE" });
}
