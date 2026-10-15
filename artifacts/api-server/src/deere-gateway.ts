import { AiError } from "./assessment-ai";

export type DeereConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  registration: string;
};

const issuers = [
  "https://sso-dev.johndeere.com/oauth2/ausx8znnnrQpD7x0f0h7",
  "https://sso.johndeere.com/oauth2/aushh24tmyH9xSbQ21t7",
];

export function deereConfig(env: Record<string, string | undefined>) {
  const base = env.AI_GATEWAY_BASE_URL;
  const issuer = env.AI_GATEWAY_ISSUER;
  // Only the documented protocol and route are approved. Extend after client confirmation.
  if (base !== "https://ai-gateway.deere.com" || !issuers.includes(issuer ?? "")
    || env.AI_GATEWAY_PROTOCOL !== "openai-chat"
    || env.AI_GATEWAY_ROUTE !== "/openai/chat/completions"
    || !/^[a-zA-Z0-9._-]{1,200}$/.test(env.AI_GATEWAY_REGISTRATION_ID ?? "")
    || !/^[a-zA-Z0-9._-]{1,200}$/.test(env.AI_GATEWAY_CLIENT_ID ?? "")
    || !env.AI_GATEWAY_CLIENT_SECRET?.trim() || env.AI_GATEWAY_CLIENT_SECRET.length > 4096) {
    throw new AiError(503, "Administrator: complete Deere service credentials, approved issuer, gateway route and protocol, then restart.");
  }
  return {
    url: `${base}${env.AI_GATEWAY_ROUTE}`,
    deere: { tokenUrl: `${issuer}/v1/token`, clientId: env.AI_GATEWAY_CLIENT_ID!,
      clientSecret: env.AI_GATEWAY_CLIENT_SECRET, registration: env.AI_GATEWAY_REGISTRATION_ID! },
  };
}

export async function boundedJson(response: Response, limit = 64_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response");
  let raw = "", bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new Error("Response too large"); }
    raw += decoder.decode(value, { stream: true });
  }
  return JSON.parse(raw + decoder.decode());
}

type Token = { value: string; expiresAt: number };
type Cache = { token?: Token; pending?: Promise<Token> };
const caches = new WeakMap<DeereConfig, Cache>();

export async function serviceToken(config: DeereConfig, request: typeof fetch, rejected?: string): Promise<string> {
  let cache = caches.get(config);
  if (!cache) { cache = {}; caches.set(config, cache); }
  if (rejected && cache.token?.value === rejected) cache.token = undefined;
  if (cache.token && cache.token.expiresAt > Date.now()) return cache.token.value;
  if (!cache.pending) {
    const current = cache;
    current.pending = (async () => {
      const started = Date.now();
      const response = await request(config.tokenUrl, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AiError(response.status === 429 ? 429 : 503, "Deere service authentication unavailable. Administrator: verify issuer, service credentials and quota.");
      }
      const body = await boundedJson(response, 32_000);
      if (typeof body.access_token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(body.access_token)
        || body.access_token.length > 16_000 || body.token_type?.toLowerCase() !== "bearer"
        || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in)
        || body.expires_in < 10 || body.expires_in > 86_400) throw new Error("Invalid token response");
      const expiresAt = started + body.expires_in * 1000 - Math.min(30_000, body.expires_in * 100);
      if (expiresAt <= Date.now()) throw new Error("Expired token response");
      return current.token = { value: body.access_token, expiresAt };
    })().finally(() => { current.pending = undefined; });
  }
  return (await cache.pending!).value;
}

export async function deereRequest(config: DeereConfig, url: string, body: string, request: typeof fetch) {
  const tokens: string[] = [];
  let token = await serviceToken(config, request);
  for (let attempt = 0; ; attempt++) {
    tokens.push(token);
    const response = await request(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        "deere-ai-gateway-registration-id": config.registration },
      body,
    });
    if (attempt === 0 && (response.status === 401 || response.status === 403)) {
      await response.body?.cancel();
      token = await serviceToken(config, request, token);
      continue;
    }
    return { response, secrets: [...tokens, config.clientSecret] };
  }
}
