import { z } from "zod";
import { ListAccountAuditQueryParams, ListAccountAuditResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

// Codegen represents OpenAPI dates as Date; HTTP query values need strict calendar validation.
export const auditFilters = ListAccountAuditQueryParams.extend({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, "Start date must not follow end date.");

export async function readAudit(filters: z.infer<typeof auditFilters>) {
  const result = await pool.query(`
    SELECT e.id, e.actor_id AS "actorId", a.username AS "actorUsername",
      e.target_id AS "targetId", t.username AS "targetUsername", e.action, e.created_at AS "createdAt"
    FROM cc_account_audit e
    LEFT JOIN cc_accounts a ON a.id=e.actor_id
    LEFT JOIN cc_accounts t ON t.id=e.target_id
    WHERE ($1::text IS NULL OR e.action=$1)
      AND ($2::text IS NULL OR e.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC'))
      AND ($3::text IS NULL OR e.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC'))
    ORDER BY e.created_at DESC, e.id DESC LIMIT 26 OFFSET $4`,
  [filters.action ?? null, filters.from ?? null, filters.to ?? null, (filters.page - 1) * 25]);
  // An explicit projection plus a response allowlist prevents new DB fields leaking.
  return ListAccountAuditResponse.parse({
    entries: result.rows.slice(0, 25), page: filters.page, hasMore: result.rows.length > 25,
  });
}
