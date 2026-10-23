import { createHmac, timingSafeEqual } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Forbidden evidence field");
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, Object.create(null));
  }
  return value;
}

function digest(value: unknown, canonical: boolean): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Evidence attestation is unavailable because SESSION_SECRET is not configured");
  const serialized = JSON.stringify(canonical ? canonicalize(value) : value);
  return Buffer.from(createHmac("sha256", secret).update(serialized).digest("hex"), "hex");
}

export function attestEvidenceValue(value: unknown): string {
  return digest(value, true).toString("hex");
}

export function verifyEvidenceAttestation(value: unknown, attestation: string): boolean {
  const supplied = Buffer.from(attestation, "hex");
  const candidates = [digest(value, true), digest(value, false)];
  return candidates.some((expected) =>
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}