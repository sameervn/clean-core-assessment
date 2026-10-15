import { knowledgeFixture } from "../src/knowledge/fixture";
if (process.env.CC_TEST_KNOWLEDGE !== "true") throw new Error("Explicit development test opt-in required.");
knowledgeFixture().listen(3011, "127.0.0.1", () => console.log("Synthetic knowledge provider fixture ready on loopback port 3011; no external AI calls."));
