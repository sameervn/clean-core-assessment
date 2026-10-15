import { gzipSync } from "node:zlib";

export const exportPackages = ["pdf-lib", "pptxgenjs", "write-excel-file"];

function containsPackage(id, name) {
  return id.replaceAll("\\", "/").includes(`/node_modules/${name}/`);
}

/** Inspect Rollup's emitted graph, not source import spelling or chunk names. */
export function analyzeBundle(output, budget) {
  for (const key of ["maxRawBytes", "maxGzipBytes"]) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] <= 0) {
      throw new Error(`Invalid bundle budget: ${key}`);
    }
  }
  const chunks = new Map(output.filter(item => item.type === "chunk").map(chunk => [chunk.fileName, chunk]));
  const entries = [...chunks.values()].filter(chunk => chunk.isEntry);
  if (!entries.length) throw new Error("No JavaScript entry chunks found");
  const initial = new Set();
  function visit(fileName) {
    if (initial.has(fileName)) return;
    const chunk = chunks.get(fileName);
    if (!chunk) throw new Error(`Unresolved static JavaScript import: ${fileName}`);
    initial.add(fileName);
    for (const dependency of chunk.imports) visit(dependency);
  }
  for (const entry of entries) visit(entry.fileName);

  const errors = [];
  for (const name of exportPackages) {
    const containing = [...chunks.values()].filter(chunk =>
      Object.keys(chunk.modules).some(id => containsPackage(id, name)),
    );
    if (!containing.length) errors.push(`${name}: not found in production output; cannot verify export isolation`);
    for (const chunk of containing) {
      if (initial.has(chunk.fileName)) {
        errors.push(`${name}: eagerly loaded in ${chunk.fileName}; keep the generator behind a dynamic import`);
      }
    }
  }
  const sizes = [...initial].sort().map(fileName => {
    const code = chunks.get(fileName).code;
    return { fileName, rawBytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length };
  });
  const rawBytes = sizes.reduce((sum, item) => sum + item.rawBytes, 0);
  const gzipBytes = sizes.reduce((sum, item) => sum + item.gzipBytes, 0);
  if (rawBytes > budget.maxRawBytes) errors.push(`Initial JS raw size ${rawBytes} exceeds budget ${budget.maxRawBytes} bytes`);
  if (gzipBytes > budget.maxGzipBytes) errors.push(`Initial JS gzip size ${gzipBytes} exceeds budget ${budget.maxGzipBytes} bytes`);
  return { sizes, rawBytes, gzipBytes, errors };
}
