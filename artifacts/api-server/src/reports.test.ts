import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { XMLValidator } from "fast-xml-parser";
import { sample, validate, render, run } from "./reports/engine.mjs";
import { example } from "./reports/contract.mjs";
import { processWord } from "./reports/process";
import { permissions } from "./auth/permissions";

const mutate = (fn: (zip: PizZip) => void) => { const zip = new PizZip(sample()); fn(zip); return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }); };
const changeText = (from: string, to: string) => mutate(zip => { zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace(from, to)); });

test("sample and populated reports are valid OpenXML; repeated rows and literal text", async () => {
  await validate(sample());
  const report = render(sample(), { ...example, entity_id: 'A<&>"{entity_kind}', notes: "literal {#findings}\n& <unsafe>", ai_explanations: "AI accepted · source version 2 · stale-source" });
  const xml = new PizZip(report).file("word/document.xml")!.asText();
  assert.equal(XMLValidator.validate(xml), true);
  assert(xml.includes("A&lt;&amp;&gt;"));
  assert(xml.includes("{entity_kind}"));
  assert(xml.includes("literal {#findings}"));
  assert(xml.includes("stale-source"));
  assert(xml.includes("Example finding one"));
  assert(xml.includes("Example finding two"));
  assert.equal((xml.match(/<w:tr>/g) || []).length, 2);
  assert(!xml.includes("{/findings}"));
});
test("split Word runs, headers, footers, tables, branding image remain intact", async () => {
  const template = mutate(zip => {
    zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("{entity_id}", "{entity_</w:t></w:r><w:r><w:t>id}"));
    for (const part of ["header1", "footer1"]) {
      zip.file(`word/${part}.xml`, `<w:${part.startsWith("header") ? "hdr" : "ftr"} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{entity_name}</w:t></w:r></w:p></w:${part.startsWith("header") ? "hdr" : "ftr"}>`);
    }
    zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${["header", "footer"].map((type, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${type}1.xml"/>`).join("")}</Relationships>`);
    zip.file("[Content_Types].xml", zip.file("[Content_Types].xml")!.asText().replace("</Types>", ["header", "footer"].map(type => `<Override PartName="/word/${type}1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join("") + "</Types>"));
    zip.file("word/media/logo.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"));
  });
  await validate(template);
  const result = new PizZip(render(template, example));
  assert(result.file("word/document.xml")!.asText().includes("EXAMPLE_ONLY"));
  assert(result.file("word/header1.xml")!.asText().includes("Fictional example"));
  assert(result.file("word/footer1.xml")!.asText().includes("Fictional example"));
  assert.deepEqual(result.file("word/media/logo.png")!.asUint8Array(), new PizZip(template).file("word/media/logo.png")!.asUint8Array());
});
test("reject unknown tags, expressions, raw XML, malformed/nested loops and absent required tags", async () => {
  for (const [from, to] of [
    ["{entity_id}", "{unknown}"], ["{notes}", "{notes.toUpperCase()}"], ["{notes}", "{@notes}"],
    ["{/findings}", "{/recommendations}"], ["{entity_kind}", "untagged"],
    ["{notes}", "{#findings}{#recommendations}{text}{/recommendations}{/findings}"],
    ["{notes}", "{text}"],
  ]) await assert.rejects(validate(changeText(from, to)));
});
test("reject dangerous packages, invalid XML, external relationships and archive bombs", async () => {
  const attacks = [
    mutate(z => z.file("word/vbaProject.bin", "macro")),
    mutate(z => z.file("word/document.xml", "<!DOCTYPE x [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><x/>")),
    mutate(z => z.file("word/_rels/document.xml.rels", '<Relationships><Relationship TargetMode="External" Target="https://example.com" Type="image"/></Relationships>')),
    mutate(z => z.file("word/_rels/document.xml.rels", '<r:Relationships xmlns:r="x"><r:Relationship TargetMode="External" Target="https://example.com"/></r:Relationships>')),
    mutate(z => z.file("word/media/a.png", Buffer.alloc(20_000_001))),
    mutate(z => { for (let i = 0; i < 301; i++) z.file(`word/header${i}.xml`, "<w/>"); }),
    changeText("{notes}", '<w:fldSimple w:instr="DDEAUTO"/>'),
    changeText("{notes}", '<v:imagedata src="https://example.com"/>'),
    changeText("{notes}", "<w:broken>"),
    Buffer.from("not a docx"),
  ];
  for (const attack of attacks) await assert.rejects(validate(attack));
  const encrypted = Buffer.from(sample()); encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  await assert.rejects(validate(encrypted));
});
test("bulk reports are unique and collision-safe; interface wins; missing optional values explicit", async () => {
  const bytes = await run({ mode: "render", entities: [
    { ...example, entity_id: "a/b", entity_kind: "object" },
    { ...example, entity_id: "a/b", entity_kind: "interface" },
    { entity_id: "a?b", entity_kind: "object" },
  ] });
  const zip = new PizZip(bytes), names = Object.keys(zip.files);
  assert.equal(names.length, 2);
  assert(names.some(n => n.includes("interface")));
  assert.notEqual(names[0], names[1]);
  const last = new PizZip(zip.file(names[1])!.asUint8Array()).file("word/document.xml")!.asText();
  assert(last.includes("Not provided"));
});
test("killable worker generates real files and cancellation fails closed", async () => {
  const bytes = await processWord({ mode: "render", entities: [example] });
  assert(new PizZip(bytes).file("word/document.xml"));
  const ac = new AbortController(); ac.abort();
  await assert.rejects(processWord({ mode: "sample" }, ac.signal), /cancelled/);
});
test("management defaults and reviewer overrides are explicit", () => {
  assert(permissions("Admin", {}).includes("templates.manage"));
  assert(permissions("Developer", {}).includes("templates.manage"));
  assert(!permissions("Reviewer", {}).includes("templates.manage"));
  assert(permissions("Reviewer", { "templates.manage": true }).includes("templates.manage"));
  assert(!permissions("Developer", { "templates.manage": false }).includes("templates.manage"));
});
