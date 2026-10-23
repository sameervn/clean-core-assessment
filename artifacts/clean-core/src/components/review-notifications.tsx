import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import type { ReviewNotificationPage, ReviewNotificationPreference } from "@workspace/api-client-react";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const BASE = "/api/shared-assessments/notifications";

export function ReviewNotifications({ onOpen }: { onOpen: (assessmentId: string, entityId?: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const key = ["review-notifications", user!.id];
  const prefKey = ["review-notification-preference", user!.id];
  const pref = useQuery({ queryKey: prefKey, queryFn: ({ signal }) => apiJson<ReviewNotificationPreference>(`${BASE}/preferences`, { signal }), refetchOnWindowFocus: true, refetchInterval: 20_000 });
  const list = useInfiniteQuery({
    queryKey: [...key, filter],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ filter });
      if (pageParam) params.set("cursor", pageParam);
      return apiJson<ReviewNotificationPage>(`${BASE}?${params}`, { signal, cache: "no-store" });
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    setBusy(true); setError("");
    try {
      const next = await apiJson<ReviewNotificationPreference>(`${BASE}/preferences`, { method: "PUT", json: { enabled: !pref.data!.enabled } });
      qc.setQueryData(prefKey, next);
    } catch { setError("Notification preference was not saved. Please retry."); }
    finally { setBusy(false); }
  };
  const markRead = async (id: string) => {
    setBusy(true); setError("");
    try {
      await apiJson(`${BASE}/${id}/read`, { method: "PUT" });
      await qc.invalidateQueries({ queryKey: key });
    } catch { setError("Could not mark this notification read. Please retry."); }
    finally { setBusy(false); }
  };
  // Infinite-query refetches rebuild pages using fresh cursors, including after a
  // mark-read removes an item from the unread view. Never merge a new first page
  // with stale offset-based pages. IDs are unique even during cache transitions.
  const notifications = [...new Map(
    (list.data?.pages.flatMap(page => page.notifications) ?? []).map(n => [n.id, n]),
  ).values()];
  return <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-label="Review notifications">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-[#081d33]"><Bell className="h-4 w-4" />Notifications{list.data && ` · ${notifications.filter(n => !n.read).length} unread shown`}</h3>
        <p className="mt-1 text-xs text-slate-600">Optional in-app alerts for new assignments, submissions and requested changes. No email or desktop messages. Only future events are included when enabled.</p>
      </div>
      <Button size="sm" variant="outline" disabled={!pref.data || busy} onClick={() => void toggle()} data-testid="button-toggle-review-notifications">
        {pref.isLoading ? "Loading preference…" : pref.data?.enabled ? "Turn notifications off" : "Enable notifications"}
      </Button>
    </div>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter notifications">
      <Button size="sm" variant={filter === "all" ? "default" : "outline"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</Button>
      <Button size="sm" variant={filter === "unread" ? "default" : "outline"} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread</Button>
      <Button size="sm" variant="ghost" disabled={list.isFetching || busy} onClick={() => void list.refetch()}>Refresh notifications</Button>
    </div>
    {(error || pref.error || list.error) && <div role="alert" className="text-sm text-red-800">
      {error || (list.isFetchNextPageError ? "Older notifications could not be loaded. Retry Load more; the loaded alerts are still available." : "Notifications are unavailable. Your assessment work is unaffected.")}
      <Button size="sm" variant="ghost" disabled={list.isFetching || busy} onClick={() => { void pref.refetch(); if (list.isFetchNextPageError) void list.fetchNextPage({ cancelRefetch: false }); else void list.refetch(); }}>Retry</Button>
    </div>}
    {list.isLoading && <p className="text-xs text-slate-500">Loading notifications…</p>}
    {!list.isLoading && !list.error && notifications.length === 0 && <p className="text-xs text-slate-500">{filter === "unread" ? "No unread notifications." : "No notifications yet. Alerts appear here shortly after an event is saved."}</p>}
    <ul className="divide-y divide-slate-100">
      {notifications.map(n => <li key={n.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${n.read ? "text-slate-500" : "font-medium text-slate-800"}`}>
        <div className="flex-1"><p>{n.message}</p><p className="text-xs font-normal text-slate-500">{new Date(n.createdAt).toLocaleString()}{n.read ? " · Read" : " · Unread"}</p></div>
        <Button variant="ghost" size="sm" onClick={() => onOpen(n.assessmentId, n.entityId)}>Open item</Button>
        {!n.read && <Button variant="outline" size="sm" disabled={busy} onClick={() => void markRead(n.id)}>Mark read</Button>}
      </li>)}
    </ul>
    {list.hasNextPage && <Button size="sm" variant="outline" disabled={list.isFetching || busy} onClick={() => void list.fetchNextPage({ cancelRefetch: false })}>
      {list.isFetchingNextPage ? "Loading older notifications…" : "Load more notifications"}
    </Button>}
    {notifications.length > 0 && !list.hasNextPage && !list.isFetching && <p className="text-xs text-slate-500">All {filter === "unread" ? "unread " : ""}notifications loaded.</p>}
  </section>;
}
