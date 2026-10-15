import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccountAuditAction, AccountAuditPage } from "@workspace/api-client-react";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const actions: Record<AccountAuditAction, string> = {
  bootstrap: "Initial Admin created", user_created: "Account created", user_updated: "Account updated (legacy)",
  role_changed: "Role changed", permissions_changed: "Permission overrides changed",
  user_activated: "Account activated", user_deactivated: "Account deactivated",
  password_reset: "Password reset", password_changed: "Password changed",
  login: "Signed in", login_failed: "Sign-in failed", logout: "Signed out",
};

export function AccountAudit() {
  const { user, isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalid = Boolean(from && to && from > to);
  const query = useQuery({
    queryKey: ["admin", "audit", user?.id, page, action, from, to],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiJson<AccountAuditPage>(`/api/admin/audit?${params}`, { signal });
    },
    enabled: isAdmin && !invalid,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  if (!isAdmin) return null;
  return <section className="space-y-4 rounded-lg border bg-background p-4 shadow-sm" aria-labelledby="audit-heading">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="audit-heading" className="text-lg font-semibold">Account audit trail</h2>
      <Button variant="outline" disabled={query.isFetching || invalid} onClick={() => { setPage(1); void query.refetch(); }}>Refresh audit</Button>
    </div>
    <p className="text-xs text-muted-foreground">Read-only history, newest first. Dates and times are UTC. Older “Account updated” events do not identify the specific change. Names reflect current accounts; IDs remain available for removed accounts.</p>
    <div className="flex flex-wrap gap-4">
      <div className="space-y-1"><Label htmlFor="audit-action">Action</Label>
        <select id="audit-action" className="block h-9 rounded-md border bg-background px-2 text-sm" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
          <option value="">All actions</option>
          {Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="space-y-1"><Label htmlFor="audit-from">From (UTC)</Label><Input id="audit-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></div>
      <div className="space-y-1"><Label htmlFor="audit-to">Through (UTC)</Label><Input id="audit-to" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></div>
      <Button variant="ghost" onClick={() => { setAction(""); setFrom(""); setTo(""); setPage(1); }}>Clear filters</Button>
    </div>
    {invalid ? <p role="alert" className="text-sm text-destructive">Start date must be on or before end date.</p>
      : query.isError ? <div role="alert"><p className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => query.refetch()}>Retry audit</Button></div>
      : query.isPending ? <p role="status">Loading audit history…</p>
      : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b">{["Time (UTC)", "Action", "Performed by", "Affected account"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{query.data.entries.map(entry => <tr key={entry.id} className="border-b">
            <td className="whitespace-nowrap p-2">{new Date(entry.createdAt).toISOString().replace("T", " ").replace(".000Z", "")}</td>
            <td className="p-2">{actions[entry.action]}</td>
            <td className="p-2">{entry.actorUsername ?? (entry.actorId ? "Removed account" : "System / unauthenticated")}{entry.actorId && <span className="block font-mono text-[10px] text-muted-foreground">{entry.actorId}</span>}</td>
            <td className="p-2">{entry.targetUsername ?? (entry.targetId ? "Removed account" : "—")}{entry.targetId && <span className="block font-mono text-[10px] text-muted-foreground">{entry.targetId}</span>}</td>
          </tr>)}</tbody>
        </table>
        {!query.data.entries.length && <p className="p-6 text-center text-muted-foreground">No audit events match these filters.</p>}
      </div>}
    <div className="flex items-center justify-end gap-3">
      <Button variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
      <span className="text-sm" aria-live="polite">Page {page}</span>
      <Button variant="outline" disabled={invalid || query.isError || query.isFetching || !query.data?.hasMore} onClick={() => setPage(p => p + 1)}>Next</Button>
    </div>
  </section>;
}
