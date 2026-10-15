import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AiError } from "../assessment-ai";

export type Passage = { section: string; text: string };
export function parseDocument(bytes: Buffer, filename: string): Promise<Passage[]> {
  const ext = filename.split(".").pop()!.toLowerCase();
  if (!["pdf", "docx", "txt", "md", "markdown"].includes(ext)) throw new AiError(400, "Supported formats: PDF, DOCX, TXT, Markdown.");
  // Separate killable process: hostile compressed/parser inputs cannot block the API event loop.
  return new Promise((resolve, reject) => {
    const worker = fork(fileURLToPath(new URL("./parser-worker.mjs", import.meta.url)), [], {
      execArgv: ["--max-old-space-size=128"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { PATH: process.env.PATH }, // no provider/database/storage credentials in parser
    });
    let done = false;
    const finish = (error?: Error, passages?: Passage[]) => {
      if (done) return;
      done = true; clearTimeout(timer); worker.kill("SIGKILL");
      error ? reject(error) : resolve(passages!);
    };
    const timer = setTimeout(() => finish(new AiError(400, "Document processing exceeded 20 seconds. Split or simplify the document.")), 20_000);
    worker.on("error", () => finish(new AiError(400, "Document parser could not start.")));
    worker.on("exit", () => finish(new AiError(400, "Document parser failed or exceeded memory limits.")));
    worker.on("message", (message: any) => {
      if (message.error) finish(new AiError(400, String(message.error).slice(0, 300)));
      else if (Array.isArray(message.passages)) finish(undefined, message.passages);
      else finish(new AiError(400, "Document parser returned invalid text."));
    });
    worker.send({ bytes: bytes.toString("base64"), ext });
  });
}
