import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeBundle } from "./bundle-analysis.mjs";

// These are build-only defaults, not credentials or runtime configuration.
process.env.NODE_ENV = "production";
process.env.PORT ||= "5173";
process.env.BASE_PATH ||= "/";

const { build } = await import("vite");
const budget = JSON.parse(await readFile(new URL("../bundle-budget.json", import.meta.url), "utf8"));
const result = await build({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  mode: "production",
  // Inspect the real minified output without overwriting dist or the running app.
  build: { write: false },
});
const builds = Array.isArray(result) ? result : [result];
if (builds.some(item => !Array.isArray(item.output))) {
  throw new Error("Expected a completed production build, not a build watcher");
}
const report = analyzeBundle(builds.flatMap(item => item.output), budget);
console.table(report.sizes);
console.log(`Initial JavaScript: ${report.rawBytes} raw bytes / ${budget.maxRawBytes} budget; ${report.gzipBytes} gzip bytes / ${budget.maxGzipBytes} budget.`);
if (report.errors.length) {
  console.error(report.errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS: PDF, PowerPoint and XLSX generators are outside the initial static import graph.");
}
