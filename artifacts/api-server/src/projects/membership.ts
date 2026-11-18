import { projectDatabaseScope, type PoolClient } from "@workspace/db";
import { AiError } from "../assessment-ai";

/** In a write transaction, revocation waits for the already-authorized save.
 * After revocation commits, no subsequent save can authorize itself.
 */
export async function lockProjectMembership(c: Pick<PoolClient, "query">, userId: string | number) {
  const scope = projectDatabaseScope();
  if (!scope) return; // Control-plane operations and isolated unit fixtures.
  const member = await c.query(`SELECT user_id FROM public.cc_project_members
    WHERE project_id=$1 AND user_id=$2 FOR SHARE`, [scope.projectId, String(userId)]);
  if (!member.rowCount) throw new AiError(404, "Project access was removed. No change was saved.");
}
