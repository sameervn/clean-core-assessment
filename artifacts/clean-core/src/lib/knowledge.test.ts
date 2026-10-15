import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTopics, validateKnowledgeUpload, KNOWLEDGE_MAX_BYTES } from "./knowledge";

const ok = { title: "Guide", release: "S4HANA_2025", topics: [] as string[], file: { name: "a.pdf", size: 10 } };

test("parseTopics trims and dedupes case-insensitively", () => {
  assert.deepEqual(parseTopics(" BAdI, badi ,  , RAP"), ["BAdI", "RAP"]);
});
test("valid upload passes", () => assert.equal(validateKnowledgeUpload(ok), null));
test("rejects bad inputs", () => {
  assert.match(validateKnowledgeUpload({ ...ok, title: "x".repeat(201) })!, /200/);
  assert.match(validateKnowledgeUpload({ ...ok, release: "x".repeat(51) })!, /50/);
  assert.match(validateKnowledgeUpload({ ...ok, topics: Array(9).fill("t") })!, /8 topics/);
  assert.match(validateKnowledgeUpload({ ...ok, topics: ["x".repeat(41)] })!, /40/);
  assert.match(validateKnowledgeUpload({ ...ok, file: { name: "a.exe", size: 1 } })!, /PDF/);
  assert.match(validateKnowledgeUpload({ ...ok, file: { name: "a.md", size: KNOWLEDGE_MAX_BYTES + 1 } })!, /8 MB/);
  assert.match(validateKnowledgeUpload({ ...ok, file: null })!, /Choose/);
});
