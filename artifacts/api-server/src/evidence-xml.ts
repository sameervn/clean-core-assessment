import { SaxesParser } from "saxes";

export function evidenceKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["proto", "prototype", "constructor"].includes(normalized)) throw new Error("Forbidden evidence field");
  if (key.length > 100) throw new Error("Evidence field name exceeds 100 characters");
  return normalized;
}

/** Streaming XML: no DTD/entities, bounded depth/nodes/fields and no backtracking. */
export function parseEvidenceXml(content: string): Record<string, unknown>[] {
  const parser = new SaxesParser({ xmlns: true });
  const records: Record<string, unknown>[] = [];
  const stack: { name: string; text: string; children: boolean }[] = [];
  let current: Record<string, unknown> | undefined, recordDepth = 0, nodes = 0;
  const recordNames = new Set(["finding", "atcresult", "result", "item", "row", "record", "object", "entry"]);
  const set = (key: string, value: string) => {
    if (value.length > 20_000) throw new Error("Evidence field exceeds 20,000 characters");
    current![evidenceKey(key)] = value.trim();
  };
  parser.on("doctype", () => { throw new Error("DTD and entity declarations are not supported"); });
  parser.on("opentag", tag => {
    if (++nodes > 200_000 || stack.length >= 64) throw new Error("XML complexity limit exceeded");
    evidenceKey(tag.local);
    if (stack.length) stack[stack.length - 1].children = true;
    stack.push({ name: tag.local, text: "", children: false });
    const attrs = Object.values(tag.attributes);
    if (attrs.length > 128) throw new Error("Too many XML attributes");
    for (const attr of attrs) evidenceKey(attr.local);
    if (!current && recordNames.has(tag.local.toLowerCase())) {
      current = Object.create(null); recordDepth = stack.length;
      for (const attr of attrs) if (attr.prefix !== "xmlns" && attr.name !== "xmlns") set(attr.local, attr.value);
    }
  });
  const text = (value: string) => {
    const top = stack[stack.length - 1];
    if (!current || !top) return;
    if (top.text.length + value.length > 20_000) throw new Error("Evidence field exceeds 20,000 characters");
    top.text += value;
  };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", () => {
    const top = stack.pop()!;
    if (!current) return;
    if (stack.length === recordDepth && !top.children) set(top.name, top.text);
    if (stack.length < recordDepth) {
      if (Object.keys(current).length) records.push(current);
      if (records.length > 20_000) throw new Error("Evidence exceeds 20,000 rows");
      current = undefined;
    }
  });
  parser.write(content).close();
  if (!records.length) throw new Error("XML must contain finding, result, item, row, record, object, or entry elements");
  return records;
}
