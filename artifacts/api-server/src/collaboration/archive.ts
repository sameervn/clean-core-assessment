import { z } from "zod";
import type { PoolClient } from "@workspace/db";
import { ListSharedApprovalsQueryParams, ListSharedApprovalsResponse } from "@workspace/api-zod";

const position = z.object({
  // Preserve PostgreSQL microseconds: converting this to a JS Date loses tie precision.
  time: z.string().datetime({ precision: 6 }),
  id: z.string().uuid(),
}).strict();
const cursorSchema = z.object({
  v: z.literal(1), owner: z.string(), filters: z.string(),
  upper: position, after: position.nullable(),
}).strict();
const encode = (value: z.infer<typeof cursorSchema>) => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function approvalPage(c: Pick<PoolClient, "query">, userId: string, query: unknown) {
  const input = ListSharedApprovalsQueryParams.strict().parse(query);
  const search = (input.search ?? "").trim();
  const filters = JSON.stringify([search, input.kind, input.showSuperseded, input.limit]);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (input.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))); }
    catch { throw new z.ZodError([{ code: "custom", path: ["cursor"], message: "Invalid archive cursor" }]); }
    if (cursor.owner !== userId || cursor.filters !== filters)
      throw new z.ZodError([{ code: "custom", path: ["cursor"], message: "Cursor does not match filters" }]);
  }
  const values: unknown[] = [userId];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const where = ["m.user_id=$1"];
  if (input.showSuperseded === "false") where.push("e.state='Approved' AND e.version=p.version");
  if (input.kind !== "all") where.push(`e.kind=${bind(input.kind)}`);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`concat_ws(' ',e.name,a.name,u.username,to_char(p.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),p.version::text) ILIKE ${term} ESCAPE '\\'`);
  }
  if (cursor) {
    where.push(`(p.approved_at,p.id)<=(${bind(cursor.upper.time)}::timestamptz,${bind(cursor.upper.id)}::uuid)`);
    if (cursor.after) where.push(`(p.approved_at,p.id)<(${bind(cursor.after.time)}::timestamptz,${bind(cursor.after.id)}::uuid)`);
  }
  const rows = (await c.query(`SELECT p.id,p.entity_id,p.version,
    to_char(p.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS approved_at,
    e.kind,e.name,e.assessment_id,a.name AS assessment_name,u.username AS approver,
    p.template_version,v.name AS template_name,(e.state<>'Approved' OR e.version<>p.version) AS superseded
    FROM cc_assessment_approvals p JOIN cc_assessment_entities e ON e.id=p.entity_id
    JOIN cc_shared_assessments a ON a.id=e.assessment_id
    JOIN cc_assessment_members m ON m.assessment_id=a.id JOIN cc_accounts u ON u.id=p.approver_id
    LEFT JOIN cc_company_template_versions v ON v.template_id=p.template_id AND v.version=p.template_version
    WHERE ${where.join(" AND ")} ORDER BY p.approved_at DESC,p.id DESC LIMIT ${bind(input.limit + 1)}`, values)).rows;
  const approvals = rows.slice(0, input.limit);
  const first = approvals[0], last = approvals.at(-1);
  const base = cursor ?? (first ? { v: 1 as const, owner: userId, filters, upper: { time: first.approved_at, id: first.id }, after: null } : null);
  return ListSharedApprovalsResponse.parse({
    approvals, pageCursor: base ? encode(base) : null,
    nextCursor: rows.length > input.limit && base && last ? encode({ ...base, after: { time: last.approved_at, id: last.id } }) : null,
  });
}
