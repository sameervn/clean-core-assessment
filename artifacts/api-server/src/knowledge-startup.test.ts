import { test } from "node:test";
import assert from "node:assert/strict";
import { startKnowledgeInitialization } from "./knowledge/schema";
test("optional schema denial is contained and initialization never blocks core startup", async () => {
  let warned = 0;
  assert.equal(startKnowledgeInitialization(() => { warned++; }, async () => { throw new Error("DDL denied"); }), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warned, 1);
  assert.equal(startKnowledgeInitialization(() => { warned++; }, () => new Promise(() => {})), undefined);
  assert.equal(warned, 1);
});
