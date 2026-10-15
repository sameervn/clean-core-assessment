import assert from "node:assert/strict";
import test from "node:test";
import { parseCleanCoreEvidence } from "./clean-core-assessment";

test("normalizes equivalent JSON, CSV, TSV, XML and text evidence", () => {
  const files = [
    '[{"objectName":"ZREPORT","severity":"high","finding":"Unreleased API"}]',
    'objectName,severity,finding\nZREPORT,high,Unreleased API',
    'objectName\tseverity\tfinding\nZREPORT\thigh\tUnreleased API',
    '<results><item><objectName>ZREPORT</objectName><severity>high</severity><finding>Unreleased API</finding></item></results>',
    'ZREPORT: high: Unreleased API',
  ];
  const expected = parseCleanCoreEvidence("atc", files[0]);
  for (const file of files) assert.deepEqual(parseCleanCoreEvidence("atc", file), expected);
});

test("rejects empty, malformed and unsafe XML evidence", () => {
  for (const file of ["", "{}", "not evidence", "{broken",
    '<!DOCTYPE x [<!ENTITY payload SYSTEM "file:///etc/passwd">]><item><objectName>Z</objectName></item>',
    '[{"objectName":"Z","collectionStart":"2026-09-01","collectionEnd":"2026-08-01"}]']) {
    assert.throws(() => parseCleanCoreEvidence("atc", file));
  }
});

test("quoted CSV delimiters are preserved", () => {
  const result = parseCleanCoreEvidence("atc", 'objectName,finding\nZREPORT,"Use released API, not table access"');
  assert.equal(result[0].finding, "Use released API, not table access");
});
