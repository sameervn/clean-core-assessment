// Test-only HTTP process. Synthetic identity is never used by production routes.
import express from "express";
import { requestLimit } from "../../src/request-limits";
import { SharedRequestStore } from "../../src/shared-request-store";

const config = { url: process.env.TEST_LIMITER_URL!, token: "synthetic-token", namespace: "process-test" };
const store = (scope: string) => new SharedRequestStore(config, scope);
const app = express();
app.set("trust proxy", false);
let identities = 0, bodies = 0;
app.get("/health", (_req, res) => { res.sendStatus(200); });
app.get("/ready", async (_req, res) => {
  try { await store("api").probe(); res.sendStatus(200); }
  catch { res.sendStatus(503); }
});
app.get("/counters", (_req, res) => { res.json({ identities, bodies }); });
app.use("/api", requestLimit("api", 6, false, 30_000, store("api")));
app.use("/api/upload", requestLimit("upload", 2, false, 30_000, store("upload")));
app.use("/api", (req, _res, next) => {
  identities++;
  req.identity = { user: { id: req.get("x-test-account") || "one" } } as any;
  next();
});
app.use("/api/account", requestLimit("account", 2, true, 30_000, store("account")));
app.use(express.json({ verify: () => { bodies++; } }));
app.use("/api", (_req, res) => { res.sendStatus(200); });
app.use("/static", requestLimit("static", 2, false, 30_000, store("static")));
app.use("/expiry", requestLimit("expiry", 1, false, 400, store("expiry")));
app.use((_req, res) => { res.sendStatus(200); });
const server = app.listen(0, "127.0.0.1", () => {
  process.send?.({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
});
