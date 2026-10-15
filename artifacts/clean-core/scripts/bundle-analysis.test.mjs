import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBundle, exportPackages } from "./bundle-analysis.mjs";

const budget = { maxRawBytes: 10000, maxGzipBytes: 10000 };
const chunk = (fileName, overrides = {}) => ({
  type: "chunk", fileName, isEntry: false, imports: [], dynamicImports: [],
  modules: {}, code: "console.log('hello');", ...overrides,
});
function fixture() {
  return [
    chunk("entry.js", { isEntry: true, imports: ["shared.js"], dynamicImports: ["reports.js"] }),
    chunk("shared.js"),
    chunk("reports.js", { imports: ["shared.js", "vendor.js"] }),
    chunk("vendor.js", {
      modules: Object.fromEntries(exportPackages.map(name => [`/repo/node_modules/.pnpm/${name}@1/node_modules/${name}/index.js`, {}])),
    }),
  ];
}

test("excludes dynamic imports, including their transitive dependencies", () => {
  const result = analyzeBundle(fixture(), budget);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.sizes.map(item => item.fileName), ["entry.js", "shared.js"]);
});

for (const name of exportPackages) {
  test(`detects ${name} in a transitively eager chunk, regardless of filename`, () => {
    const output = fixture();
    output[1].imports = ["innocent-name.js"];
    output.push(chunk("innocent-name.js", { modules: { [`/repo/node_modules/${name}/dist/index.js`]: {} } }));
    assert.ok(analyzeBundle(output, budget).errors.some(error => error.includes(`${name}: eagerly loaded`)));
  });
}

test("counts shared chunks once across entries and handles cycles", () => {
  const output = fixture();
  output.push(chunk("second.js", { isEntry: true, imports: ["shared.js"] }));
  output[1].imports = ["entry.js"];
  const result = analyzeBundle(output, budget);
  assert.equal(result.sizes.length, 3);
  assert.equal(result.rawBytes, Buffer.byteLength(output[0].code) * 3);
});

test("fails raw and gzip budgets independently and accepts exact limits", () => {
  const result = analyzeBundle(fixture(), budget);
  assert.equal(analyzeBundle(fixture(), { maxRawBytes: result.rawBytes, maxGzipBytes: result.gzipBytes }).errors.length, 0);
  assert.match(analyzeBundle(fixture(), { ...budget, maxRawBytes: result.rawBytes - 1 }).errors.join(), /raw size/);
  assert.match(analyzeBundle(fixture(), { ...budget, maxGzipBytes: result.gzipBytes - 1 }).errors.join(), /gzip size/);
});

test("fails closed on missing generators, entries, imports or invalid budgets", () => {
  assert.equal(analyzeBundle(fixture().slice(0, 3), budget).errors.length, 3);
  assert.throws(() => analyzeBundle([], budget), /No JavaScript entry/);
  assert.throws(() => analyzeBundle([chunk("entry.js", { isEntry: true, imports: ["missing.js"] })], budget), /Unresolved static/);
  assert.throws(() => analyzeBundle(fixture(), {}), /Invalid bundle budget/);
});
