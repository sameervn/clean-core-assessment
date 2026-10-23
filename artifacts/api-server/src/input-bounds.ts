import type { RequestHandler } from "express";

/** Before schema validation: cap even unbounded/generated collections and reject
 * prototype keys at every depth. Byte limits remain on the actual body parsers. */
export function assertInputBounds(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 1_000_000 || depth > 64) throw new Error("Request complexity limit exceeded");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new Error("A collection exceeds 20,000 items");
    for (const child of value) assertInputBounds(child, depth + 1, budget);
  } else {
    const keys = Object.keys(value);
    if (keys.length > 128) throw new Error("An object exceeds 128 fields");
    for (const key of keys) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Forbidden input field");
      assertInputBounds((value as Record<string, unknown>)[key], depth + 1, budget);
    }
  }
}
export const boundRequest: RequestHandler = (req, res, next) => {
  try { assertInputBounds(req.body); next(); }
  catch { res.status(400).json({ message: "Request contains forbidden fields or exceeds collection/complexity limits." }); }
};
