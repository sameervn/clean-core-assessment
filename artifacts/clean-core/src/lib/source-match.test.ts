import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeObjectName, matchSourceFiles, normalizeObjectType, parseSourcePath } from "./source-match";

const f = (...paths: string[]) => paths.map(path => ({ path }));

test("normalizes types and namespaces", () => {
  assert.equal(normalizeObjectType("Class"), "clas");
  assert.equal(normalizeObjectType("PROG"), "prog");
  assert.equal(normalizeObjectType("function group"), "fugr");
  assert.equal(normalizeObjectType("weird type"), null);
  assert.equal(encodeObjectName("/ACME/CL_ORDER"), "#acme#cl_order");
});

test("parses abapGit class includes", () => {
  const p = parseSourcePath("src/zcl_x.clas.locals_imp.abap");
  assert.deepEqual([p.folder, p.name, p.type, p.part, p.ext], ["src", "zcl_x", "clas", "locals_imp", "abap"]);
  assert.equal(parseSourcePath("src/%23acme%23cl_a.clas.abap").name, "#acme#cl_a");
});

test("exact main with related class files, main first", () => {
  const r = matchSourceFiles(f("src/zcl_x.clas.xml", "src/zcl_x.clas.testclasses.abap", "src/zcl_x.clas.abap", "src/zcl_x.clas.locals_imp.abap", "src/zcl_other.clas.abap"), { name: "ZCL_X", type: "CLAS" });
  assert.equal(r.status, "exact");
  assert.equal(r.groups[0].main, "src/zcl_x.clas.abap");
  assert.deepEqual(r.groups[0].paths, ["src/zcl_x.clas.abap", "src/zcl_x.clas.locals_imp.abap", "src/zcl_x.clas.testclasses.abap", "src/zcl_x.clas.xml"]);
});

test("namespaced object matches #ns# filename", () => {
  const r = matchSourceFiles(f("src/#acme#cl_order.clas.abap"), { name: "/ACME/CL_ORDER", type: "Class" });
  assert.equal(r.status, "exact");
});

test("duplicate folders are ambiguous and need explicit choice", () => {
  const r = matchSourceFiles(f("a/zrep.prog.abap", "b/zrep.prog.abap"), { name: "ZREP", type: "PROG" });
  assert.equal(r.status, "ambiguous");
  assert.equal(r.groups.length, 2);
});

test("type mismatch and prefixes never match (no fuzzy)", () => {
  assert.equal(matchSourceFiles(f("src/zrep.clas.abap", "src/zrep2.prog.abap", "src/x_zrep.prog.abap"), { name: "ZREP", type: "PROG" }).status, "unmatched");
});

test("plain filenames match by exact name", () => {
  const r = matchSourceFiles(f("legacy/ZREP.abap"), { name: "zrep", type: "PROG" });
  assert.equal(r.status, "exact");
});

test("group without a main file is not exact", () => {
  assert.equal(matchSourceFiles(f("src/zfg.fugr.lzfgtop.abap", "src/zfg.fugr.lzfgu01.abap"), { name: "ZFG", type: "FUGR" }).status, "ambiguous");
});

test("caps attached paths at 10", () => {
  const many = ["src/zcl_y.clas.abap", ...Array.from({ length: 12 }, (_, i) => `src/zcl_y.clas.inc${i}.abap`)];
  const g = matchSourceFiles(f(...many), { name: "ZCL_Y", type: "CLAS" }).groups[0];
  assert.equal(g.paths.length, 10);
  assert.equal(g.truncated, true);
});

test("empty name is invalid", () => {
  assert.equal(matchSourceFiles(f("a.abap"), { name: "" }).status, "invalid");
});

test("namespaced class duplicated across folders stays ambiguous", () => {
  const r = matchSourceFiles(f("a/#acme#cl_x.clas.abap", "a/#acme#cl_x.clas.locals_def.abap", "b/#acme#cl_x.clas.abap"), { name: "/ACME/CL_X", type: "CLAS" });
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.groups.map(g => g.paths.length), [2, 1]);
});
