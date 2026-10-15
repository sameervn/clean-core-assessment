import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AiError } from "../assessment-ai";

let active = 0;
export function processWord(input: { bytes?: string; mode: string; entities?: unknown[] }, signal?: AbortSignal): Promise<Buffer> {
  if (active >= 2) return Promise.reject(new AiError(429, "Two Word jobs are running. Retry shortly."));
  if (signal?.aborted) return Promise.reject(new AiError(499, "Word generation cancelled."));
  active++;
  return new Promise((resolve, reject) => {
    const worker = fork(fileURLToPath(new URL("./worker.mjs", import.meta.url)), [], {
      execArgv: ["--max-old-space-size=192"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { PATH: process.env.PATH },
    });
    let done = false;
    const finish = (error?: Error, bytes?: Buffer) => {
      if (done) return;
      done = true; active--; clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.kill("SIGKILL");
      error ? reject(error) : resolve(bytes!);
    };
    const abort = () => finish(new AiError(499, "Word generation cancelled. No archive was produced."));
    const timer = setTimeout(() => finish(new AiError(400, "Word processing exceeded 20 seconds. Simplify the template or select fewer entities.")), 20_000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("error", () => finish(new AiError(503, "Word processor unavailable.")));
    worker.on("exit", () => finish(new AiError(400, "Word processing failed or exceeded its memory limit. Simplify the template.")));
    worker.on("message", (message: any) => {
      if (typeof message.error === "string") finish(new AiError(400, message.error));
      else if (typeof message.bytes === "string" && message.bytes.length < 55_000_000) finish(undefined, Buffer.from(message.bytes, "base64"));
      else finish(new AiError(400, "Word report output exceeded its limit."));
    });
    worker.send(input, error => { if (error) finish(new AiError(503, "Could not start Word processing.")); });
  });
}
