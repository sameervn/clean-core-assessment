# Review notifications

Open **Shared assessments → Reviewer inbox** and choose **Enable notifications**.
This account-scoped preference is off by default and applies to future events.
Developers can enable it too, to receive requested-change alerts.

Notifications are in-app only; no email provider, desktop permission, or external
destination is required. The inbox polls every 20 seconds while open. Delivery
runs every five seconds in bounded batches. Existing submitted work remains
visible in the reviewer inbox whether or not notifications are enabled.

- New assignments and submissions notify the assigned reviewer.
- Requested changes notify the item's submitter.
- Self-notifications are omitted.
- Opening a notification opens its assessment item. **Mark read** is explicit.
- The most recent 100 alerts are shown. Turning notifications off stops future
  delivery; previously delivered alerts remain subject to the retention policy below.
- Messages are fixed text with item/assessment identifiers and timestamps.
  Source code, names, narratives, evidence, and review comments are not copied.
- Current account permissions, explicit assessment membership, membership access,
  role and assignment are checked during delivery and again when reading.
  Administrators have no implicit content access.

## Reliability and migration

The existing collaboration event transaction snapshots the intended recipient.
No notification provider or notification-table write runs in the assessment save.
The worker reads committed events, inserts notifications with a unique
event/recipient key, and marks events processed in a separate transaction.
Concurrent workers use locked batches; failure rolls the batch back for retry
without affecting the saved assessment. A restart resumes pending events.
Events from before opt-in (or during opt-out) are not replayed.

The additive schema is included in `initializeCollaboration`, used by both local
bootstrap and the existing `scripts/migrate-client.ts` migration. Installations
with schema bootstrap disabled must run their normal authorized client migration
before starting the updated API. Do not grant schema changes to the runtime user.
Delivery failure logs contain no event content and are retried every five seconds.

## Retention

Delivered notifications are eligible for removal **90 days after their first
explicit Mark read** (`read_at`), regardless of notification preferences or current
membership. Unread notifications are never removed by retention cleanup. An old
event read today therefore remains available for another 90 days. Repeated Mark
read requests do not extend the window. The 100-alert display limit is not a
storage limit; unread notifications can continue to accumulate.

The asynchronous worker runs a cleanup pass on startup and after each delivery
pass (normally every five seconds). Each cleanup uses its own transaction and
deletes at most 100 eligible notification rows, oldest read first. A partial
read-time index supports this scan. Row locking with `SKIP LOCKED` allows multiple
workers to share the backlog without waiting for each other's notification rows.
Cleanup sets a one-second lock timeout and a five-second statement timeout to
bound database work; failure rolls back the pass and is retried on a later tick,
with no notification content included in logs. A busy worker does not overlap its
own passes. Delivery and cleanup failures are handled separately.

Cleanup only deletes notification rows whose event is already processed. It
**never deletes collaboration audit events or changes `notification_processed`**.
Delivery commits the notification and processed marker atomically, so an
in-flight delivery cannot be cleaned up as completed work. Committed processed
markers prevent removed notifications from being recreated, including after API
restarts, concurrent workers, schema initialization, or preference changes.
Cleanup needs no in-memory cursor: after a crash, committed deletions remain
deleted and rolled-back batches remain eligible for the next bounded pass.

Verification:

```sh
CC_TEST_COLLABORATION=true pnpm --filter @workspace/api-server exec tsx --test src/review-notifications.test.ts
CC_TEST_COLLABORATION=true pnpm --filter @workspace/api-server exec tsx --test src/review-notification-retention.test.ts
```

The integration test creates temporary accounts and assessment records in the
development database and removes them afterwards. Never run it against production.
