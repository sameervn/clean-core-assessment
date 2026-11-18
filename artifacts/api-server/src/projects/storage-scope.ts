import { projectDatabaseScope } from "@workspace/db";
import { AiError } from "../assessment-ai";

export function privateProjectRoot() {
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!root) throw new AiError(503, "Private durable storage is not configured.");
  const scope = projectDatabaseScope();
  return scope && !scope.legacy ? `${root}/projects/${scope.projectId}` : root;
}
export function assertProjectObject(path: string) {
  const scope = projectDatabaseScope();
  if (!scope) return; // Signed create-only upload capabilities and infrastructure probes.
  const root = privateProjectRoot();
  if (!path.startsWith(`${root}/`) || (scope.legacy && path.startsWith(`${root}/projects/`))) {
    throw new AiError(404, "Private file not found in this project.");
  }
}
