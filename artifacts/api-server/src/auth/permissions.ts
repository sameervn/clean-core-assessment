export const PERMISSIONS = ["view", "evidence", "run", "notes", "classify", "baseline", "ai.generate", "ai.accept", "ai.remove", "export", "restore", "reset", "knowledge.read", "knowledge.upload", "knowledge.manage-all", "templates.manage"] as const;
export type Permission = typeof PERMISSIONS[number];
export const ROLES = ["Admin", "Developer", "Reviewer"] as const;
export function permissions(role: string, overrides: Record<string, boolean>): Permission[] {
  if (role === "Admin") return [...PERMISSIONS];
  const defaults: readonly string[] = role === "Developer" ? PERMISSIONS.filter(p => p !== "knowledge.manage-all") : role === "Reviewer" ? ["view", "export", "knowledge.read"] : [];
  return PERMISSIONS.filter(p => overrides[p] ?? defaults.includes(p));
}
