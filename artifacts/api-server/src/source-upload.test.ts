import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeSourceUpload, retainUploadSources, MAX_UPLOADED_SOURCE_BYTES } from "./collaboration/source-upload";
import { mergedSources } from "./collaboration/source-mapping";

const code = "Badi Implementation - Z_FIXTURE\n\nMETHOD if_ex_fixture~execute.\n  DATA lv_text TYPE string VALUE 'Ünicode'.\nENDMETHOD.\n";
const input = (bytes = Buffer.from(code), fileName = "fixture.TXT") => ({
  expectedVersion: 1, fileName, fileBase64: bytes.toString("base64"),
});

test("source uploads preserve UTF-8 bytes, preambles, filename and SHA-256 without evidence parsing", () => {
  const result = decodeSourceUpload(input());
  assert.equal(result.bytes.toString("utf8"), code);
  assert.equal(result.sha256, createHash("sha256").update(Buffer.from(code)).digest("hex"));
  assert.equal(result.body.fileName, "fixture.TXT");
  assert.equal(decodeSourceUpload(input(Buffer.from(code), "fixture.abap")).body.expectedVersion, 1);
});

test("source validation rejects unsupported names, binary/invalid UTF-8, empty and oversized files", () => {
  for (const name of ["fixture.csv", "fixture.txt.exe", "../fixture.txt", "folder/fixture.abap", "C:\\fixture.abap", " fixture.txt", "fixture\u0001.txt", `${"a".repeat(181)}.txt`]) {
    assert.throws(() => decodeSourceUpload(input(Buffer.from(code), name)));
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from(" \t\n"), Buffer.from([0xff]), Buffer.from([0]), Buffer.from([127]), Buffer.from([1, 2, 3]), Buffer.from([0xff, 0xfe, 65, 0])]) {
    assert.throws(() => decodeSourceUpload(input(bytes)));
  }
  assert.equal(decodeSourceUpload(input(Buffer.alloc(MAX_UPLOADED_SOURCE_BYTES, 65))).bytes.length, MAX_UPLOADED_SOURCE_BYTES);
  assert.throws(() => decodeSourceUpload(input(Buffer.alloc(MAX_UPLOADED_SOURCE_BYTES + 1, 65))), /256,000/);
});

test("source upload contracts reject malformed base64, forged provenance and stale-version-shaped input", () => {
  for (const bad of [
    { ...input(), fileBase64: "!!!!" }, { ...input(), fileBase64: "eA" },
    { ...input(), fileBase64: "eA==\n" }, { ...input(), expectedVersion: 0 },
    { ...input(), expectedVersion: "1" }, { ...input(), fileBase64: { text: code } },
    { ...input(), objectPath: "/some/private/path" }, { ...input(), uploadedBy: "someone-else" },
  ]) assert.throws(() => decodeSourceUpload(bad));
});

test("uploads and GitHub snapshots coexist; replacement is origin-scoped and preserves the shared ten-file cap", () => {
  const github = { repository: "owner/repo", path: "same.abap", commit: "a".repeat(40) };
  const uploaded = { kind: "upload", path: "same.abap", sha256: "old" };
  assert.deepEqual(retainUploadSources([github, uploaded], "same.abap"), [github]);
  assert.deepEqual(mergedSources([github, uploaded], "owner/repo", ["same.abap"]), [uploaded]);
  const full = Array.from({ length: 10 }, (_, i) => ({ kind: "upload", path: `${i}.txt` }));
  assert.equal(retainUploadSources(full, "0.txt").length, 9);
  assert.throws(() => retainUploadSources(full, "new.txt"), /ten source/);
});
