import { z } from "zod";
import { MapSharedGithubSourceBody } from "@workspace/api-zod";
import type { Identity } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { removeObject } from "../knowledge/storage";
import { normalizeRepository } from "./github-credentials";
import { savedGithubConfig } from "./github-store";
import { source } from "./github";
import { storePrivate } from "./files";
import { editable, entity, event, expected, revision, transaction } from "./service";

/** Either the legacy single path or an atomic group, never both or an empty group. */
export const sourceMappingSchema = MapSharedGithubSourceBody.strict().extend({
  repository: z.string().max(200).transform(normalizeRepository),
}).superRefine((body, ctx) => {
  if ((body.path === undefined) === (body.paths === undefined)) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one path or paths." });
  }
  if (body.paths && new Set(body.paths).size !== body.paths.length) {
    ctx.addIssue({ code: "custom", message: "Source paths must be unique." });
  }
});

export function mergedSources(existing: any[], repository: string, paths: string[]) {
  const retained = existing.filter(s => s.repository !== repository || !paths.includes(s.path));
  if (retained.length + paths.length > 10) throw new AiError(400, "At most ten source files per item. Refresh existing files or choose fewer files.");
  return retained;
}

export function sameGithubSources(existing: any[], repository: string, commit: string, paths: string[]) {
  return paths.every(path => existing.some(s => s.repository === repository && s.commit === commit && s.path === path
    && /^[a-f0-9]{64}$/.test(s.sha256) && /^[a-f0-9]{40}$/.test(s.blob)));
}

/** Two authorization/version checks bracket external reads. No partial source revision is published. */
export async function mapGithubSources(
  identity: Identity, id: string, input: unknown, request: typeof fetch = fetch,
  beforeCommit?: (c: import("@workspace/db").PoolClient) => Promise<void>,
) {
  const body = sourceMappingSchema.parse(input);
  const paths = body.paths ?? [body.path!];
  const config = await savedGithubConfig(identity, body.repository);
  const unchanged = await transaction(async c => {
    const { row, user, assessment } = await entity(c, identity, id);
    if (!editable(user, assessment, row).developer) throw new AiError(403, "Only an editor can map source.");
    expected(row, body.expectedVersion);
    mergedSources(row.sources, body.repository, paths);
    if (beforeCommit) await beforeCommit(c);
    return sameGithubSources(row.sources, body.repository, body.commit, paths) ? row : null;
  });
  if (unchanged) return { entity: unchanged, proposal: null };
  const staged: any[] = [];
  try {
    // Sequential staging keeps memory and upstream concurrency bounded to one <=256 KB file.
    for (const path of paths) {
      const fetched = await source(body.repository, body.commit, path, config, request);
      const objectPath = await storePrivate("source", fetched.bytes);
      staged.push({ repository: body.repository, commit: body.commit, path, sha256: fetched.sha256, blob: fetched.blob, objectPath });
    }
    const updated = await transaction(async c => {
      const latestConfig = await savedGithubConfig(identity, body.repository, c);
      if (latestConfig.credentialVersion !== config.credentialVersion) throw new AiError(409, "GitHub connection changed while fetching. Retry with the current connection.");
      const { row, user, assessment } = await entity(c, identity, id);
      if (!editable(user, assessment, row).developer) throw new AiError(403, "Only an editor can map source.");
      expected(row, body.expectedVersion);
      if (beforeCommit) await beforeCommit(c);
      const sources = [...mergedSources(row.sources, body.repository, paths), ...staged];
      const result = (await c.query(`UPDATE cc_assessment_entities SET sources=$2,version=version+1,
        state='Draft',updated_at=now() WHERE id=$1 RETURNING *`, [id, JSON.stringify(sources)])).rows[0];
      await revision(c, identity, result, "GitHub source snapshot");
      await event(c, identity, result, "source mapped");
      return result;
    });
    // Evaluation is an independent explicit action; a missing knowledge permission must not
    // stop a permitted source read, nor should attaching evidence change assessment decisions.
    return { entity: updated, proposal: null };
  } catch (error) {
    // Older snapshots are retained for revision/approval provenance; only failed staging is removed.
    await Promise.all(staged.map(s => removeObject(s.objectPath).catch(() => undefined)));
    throw error;
  }
}
