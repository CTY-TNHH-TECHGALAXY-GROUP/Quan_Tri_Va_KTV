# TEST live sequential follow-up — proposed stable-file diff

User previously wrote `Duyệt sửa file ổn định`; this records the stable-file edits before applying them.

```diff
--- a/app/ktv/dashboard/KTVDashboard.logic.ts
+++ b/app/ktv/dashboard/KTVDashboard.logic.ts
- Unstarted KTV may inherit item PAUSED/IN_PROGRESS and keep isTimerRunning=true.
+ Derive running state from this KTV's actualStartTime; clear a stale timer for unstarted slots.
- Poll every 60000ms and skip post-service entirely.
+ Poll within 30000ms, refresh on focus/visibility, preserve the post-service booking lock.

--- a/app/api/ktv/booking/_handlers/handleStartTimer.ts
+++ b/app/api/ktv/booking/_handlers/handleStartTimer.ts
- Require A actualEndTime before B may start.
+ Require A actualStartTime; B may start while A is still serving.

--- a/app/reception/dispatch/page.tsx
+++ b/app/reception/dispatch/page.tsx
- Treat every revision change during an open form as an unrebasable conflict.
+ Advance the form revision when the server changed only runtime stamps, preserving user edits.
- Show a generic unexpected error even after the dispatch transaction committed.
+ Refresh the board and show whether the commit succeeded or actually failed.

--- a/supabase/migrations/*
+++ b/supabase/migrations/20260929160000_live_queue_and_early_b.sql
- Exclude ACTIVE, QUEUED and READY assignments from overlapping planned windows.
+ Exclude ACTIVE assignments only; later QUEUED work can be sent before the current ca ends.
- Reject a B plan earlier than A's newly edited planned end.
+ Permit A/B overlap within one service while preserving cross-order active conflicts.
- Treat PAUSED as outside the editable live-dispatch paths.
+ Keep PAUSED on those paths so admin can edit and dispatch without resuming the timer.
```

New regression checks will exercise pause/resume, queued dispatch, B early start and form revision rebasing. No Supabase Pro database mutation is in scope.
