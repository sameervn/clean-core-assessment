/** Conservative bulk counterpart of manual abapGit matching. Never choose a partial group. */
type File = { path: string; sha: string; size: number };
const aliases: Record<string, string> = {
  class: "clas", "global class": "clas", interface: "intf", program: "prog", report: "prog", include: "prog",
  "function group": "fugr", function: "fugr", func: "fugr", "function module": "fugr",
  cds: "ddls", "cds view": "ddls", "data definition": "ddls", table: "tabl", structure: "tabl",
  "data element": "dtel", domain: "doma", "table type": "ttyp", enhancement: "enho",
  "enhancement implementation": "enho", "behavior definition": "bdef", transaction: "tran", "message class": "msag",
};
const mainExtensions = new Set(["abap", "asprog", "asclas", "asintf", "acds", "ddls", "asddls", "asbdef", "asdcls", "srvdsrv"]);
export function bulkMatch(files: File[], name: string, rawType?: unknown): { status: "ready" | "ambiguous" | "unmatched"; paths: string[]; message: string } {
  const target = name.trim().toLowerCase().replaceAll("/", "#");
  const inputType = String(rawType ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const type = aliases[inputType] ?? (/^[a-z]{4}$/.test(inputType) ? inputType : null);
  const groups = new Map<string, { paths: string[]; mains: string[]; oversized: boolean }>();
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const base = file.path.slice(slash + 1).toLowerCase();
    const parts = base.split(".");
    // Bulk imports require typed abapGit filenames; legacy names stay manual.
    if (parts.length < 3 || !/^[a-z]{4}$/.test(parts[1]) || parts[0] !== target || (type && type !== parts[1])) continue;
    const key = `${file.path.slice(0, slash + 1)}|${parts[1]}`;
    const group = groups.get(key) ?? { paths: [], mains: [], oversized: false };
    group.paths.push(file.path);
    group.oversized ||= file.size > 256_000;
    if (parts.length === 3 && mainExtensions.has(parts[2])) group.mains.push(file.path);
    groups.set(key, group);
  }
  const group = [...groups.values()][0];
  if (!group) return { status: "unmatched", paths: [], message: "No typed abapGit source match. Map files manually." };
  if (groups.size !== 1 || group.mains.length !== 1 || group.paths.length > 10 || group.oversized)
    return { status: "ambiguous", paths: [...groups.values()].flatMap(g => g.paths).slice(0, 30), message: "Multiple candidates, missing main file, oversized files, or more than ten related files. Map manually." };
  return { status: "ready", paths: [group.mains[0], ...group.paths.filter(p => p !== group.mains[0]).sort()], message: "One complete abapGit group." };
}
