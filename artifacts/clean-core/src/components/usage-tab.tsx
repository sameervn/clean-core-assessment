import { useMemo, useState } from "react";
import { Activity, CircleSlash, HelpCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usageFor, type UsageStatus } from "@/lib/usage-status";

const META: Record<UsageStatus, { label: string; icon: any; tone: string }> = {
  "in-use": { label: "In use", icon: Activity, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  "not-in-use": { label: "Not in use", icon: CircleSlash, tone: "text-slate-700 bg-slate-100 border-slate-300" },
  unknown: { label: "Unknown", icon: HelpCircle, tone: "text-amber-800 bg-amber-50 border-amber-200" },
};

export function UsageTab({ ctx }: { ctx: any }) {
  const [filter, setFilter] = useState<UsageStatus | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => (ctx.assessment?.inventory || []).map((item: any) => ({ item, u: usageFor(item, ctx.evidence) })), [ctx.assessment, ctx.evidence]);
  if (!ctx.assessment) return <p className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-usage">Run an assessment to see usage status.</p>;
  const counts = { "in-use": 0, "not-in-use": 0, unknown: 0 } as Record<UsageStatus, number>;
  rows.forEach((r: any) => counts[r.u.status as UsageStatus]++);
  const shown = rows.filter((r: any) => (filter === "all" || r.u.status === filter) && (!q || String(r.item.objectName).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="mx-auto h-full max-w-6xl space-y-4 overflow-y-auto pb-8 pr-2">
      <div><h2 className="text-2xl font-semibold">Usage</h2><p className="text-sm text-muted-foreground">Conservative: a positive count means in use. Not in use requires an explicit zero over a complete observation period with 100% telemetry coverage. Everything else is unknown.</p></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(Object.keys(META) as UsageStatus[]).map(k => { const M = META[k]; return (
          <button key={k} onClick={() => setFilter(f => f === k ? "all" : k)} data-testid={`card-usage-${k}`}
            className={`flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-all hover:-translate-y-px hover:shadow-sm ${filter === k ? "ring-2 ring-primary/30" : ""}`}>
            <span className={`rounded-md border p-2 ${M.tone}`}><M.icon className="h-5 w-5" /></span>
            <span><span className="block text-2xl font-semibold tabular-nums" data-testid={`text-usage-count-${k}`}>{counts[k]}</span><span className="text-xs text-muted-foreground">{M.label}</span></span>
          </button>); })}
      </div>
      <div className="relative max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search objects" className="pl-8" data-testid="input-usage-search" /></div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {shown.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No objects match.</p>}
        {shown.slice(0, 1000).map(({ item, u }: any) => { const M = META[u.status as UsageStatus]; return (
          <div key={item.id} className="border-b last:border-0">
            <button onClick={() => setOpen(o => o === item.id ? null : item.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40" data-testid={`row-usage-${item.id}`}>
              <span className="min-w-0 flex-1 truncate font-medium">{item.objectName}<span className="ml-2 font-mono text-[10px] text-muted-foreground">{item.objectType}</span></span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{u.count ?? "—"}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[11px] ${M.tone}`}>{M.label}</span>
            </button>
            {open === item.id && <dl className="grid gap-1 bg-muted/30 px-4 py-2 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Basis</dt><dd>{u.reason}</dd></div>
              <div><dt className="text-muted-foreground">Observation period</dt><dd>{u.period || "Not provided"}</dd></div>
              <div><dt className="text-muted-foreground">Observed count</dt><dd>{u.count ?? "No usage row"}</dd></div>
            </dl>}
          </div>); })}
        {shown.length > 1000 && <p className="p-3 text-center text-xs text-muted-foreground">Showing first 1,000 of {shown.length}. Refine search.</p>}
      </div>
    </div>
  );
}
