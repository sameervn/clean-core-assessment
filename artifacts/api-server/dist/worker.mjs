import { run } from "./engine.mjs";
process.once("message", async message => {
  try { process.send({ bytes: (await run(message)).toString("base64") }); }
  catch (e) { process.send({ error: String(e.message || "Word report failed.").slice(0, 1000) }); }
  finally { process.disconnect(); }
});
