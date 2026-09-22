# Wallet root-cause investigation — T007, 45 minutes, 74,439 VND

Date: 2026-09-22. Scope: read-only investigation, proposed implementation and rollout. No application or financial data changes in this investigation.

## 1. Correction to the previous conclusion

The previous claim that this was fixed end to end was too broad. It verified two manually repaired T027 rows and two deployed branches, but did not exercise all deployments able to write the shared ledger, nor reconcile other rows left by the old formula. Passing pure calculation tests and receiving a correct value for a manually patched row did not establish that subsequent writes were safe.

The arithmetic fix itself returns the approved amount for T007's exact record. The remaining root problem is control over which deployed calculator can write durable wallet data, plus failure to discover and repair results computed under the previous rule.

## 2. Exact evidence from the reported row

| Field | Live value |
|---|---|
| Staff / work type | T007 / TYPE_D |
| Bill / item | 015-21092026 / 11NDK-015-21092026-item1 |
| Service | NHS0909 — Mát-xa đầu cổ vai & tay (45p) |
| Item / ledger status | DONE / FINAL, unlocked |
| Assigned / displayed actual minutes | 45 / 45 |
| Start (UTC) | 2026-09-21T16:34:57.305Z |
| End (UTC) | 2026-09-21T17:19:37.094Z |
| Elapsed work | 44 minutes 39.789 seconds = 44.66315 minutes |
| Custom minutes / counter closure | null / false |
| Pauses / voided / early-finish note | None in the returned segment |
| Stored paid minutes | 44.66315 |
| Hourly rate | 100,000 |
| Stored gross commission | 74,438.58333333334 |
| Stored tax | 7,443.8583333333345 |
| Bonus / rating deduction | 0 / 0 |
| Last computation | 2026-09-21T17:42:00.946Z = 00:42:00.946, 22 September VN |
| Source metadata | EVENT; no deployment SHA or formula revision |
| Recompute queue for this item | Empty |

Current engine replay: assigned=45, actual=45, paid=45, gross=75,000. Old engine replay from origin/fix/shift-extension-phase1: paid=44.66315, gross=74,438.58333333333. Both replays used the actual timestamps above.

Expected money: 75,000 gross; 7,500 TNCN under the application's configured 10% rule; 67,500 net. Current raw net is 66,994.725. Difference: 561.416666... gross, 56.141666... tax and 505.275 net VND. These are differences in calculations, not proof of a completed cash withdrawal.

74,439 is Math.round(74,438.583...). The current wallet's formatVnd truncates it to 74,438, while history rounds it to 74,439. The user-visible amount identifies the same underlying ledger error; the exact screen/browser version displaying it was not independently captured. Rounding explains at most one dong, not the missing 561.416666... dong.

Item options include autoCompletedNoRating=true and autoCompletedAt=2026-09-21T17:27:00.031Z. That is the later completion/feedback stage. It is not an early-termination instruction and must not reduce earned base pay.

## 3. Deployed stale calculator — confirmed

Vercel shows deployment `2sZXFYrtW82SR1ZxxMUSiobcoKNE` Ready and Latest for `fix/shift-extension-phase1`, source `20a8830060a574fb8cc1101307509dd0b4592388`, ready at 00:36:22 VN on 22 September. Its alias is:

https://quan-tri-va-ktv-git-fix-shift-extension-phase1-tech-galaxy.vercel.app

That exact commit still contains:

```ts
paid += hasMarks ? Math.min(workedMs / 60000, gan) : gan;
```

Its dispatch server action calls both drainQueueForStaff and drainQueueBackground. Its writer directly upserts KTVDTurnLedger. This deployment became ready approximately six minutes before the incorrect row's last computed_at timestamp.

The other two verified branches contain the corrected calculation: `feat/bit-lo-hong-phase1` at 0c580cc3 (fix e870c098), and production main at aa5d7d9a. Updating them did not update the shift-extension branch or revoke old immutable deployments.

**Attribution limit:** this makes the shift-extension deployment a strong, concrete candidate. The row has no deployment identity, and its exact writing HTTP request was not recovered. Therefore it is not proven that this specific deployment made the 00:42 write. What is proven is that a deployed old formula exactly reproduces the stored value and has a live writer path. The application configuration observed previously exposes the Supabase configuration to all environments; final rollout must verify server credentials/target project for each deployment, not assume isolation from the word Preview.

## 4. End-to-end failure mechanism

1. BookingItems changes enqueue the item via database triggers.
2. Cron is only one consumer. Dispatch, history, wallet timeline, hours ledger and hours ranking can also drain the queue, some from a GET/read flow.
3. Each deployment runs its own compiled copy of KtvDLedgerEngine. A common source filename does not mean a common deployed calculator.
4. KtvDLedgerWriter upserts by (staff_id, booking_item_id), with no comparison of calculation revision or source commit. A permitted older application can replace a newer result. The read-then-skip LOCKED check is also not a transactional lock guarantee.
5. takeAndRecompute deletes queue entries before recalculating. Deletes are not checked for errors. Concurrent consumers may both select the same entries, then calculate and write; the last write wins.
6. The queue has no generation token. If a source update arrives between select and delete, the worker can remove newer work. On failure, requeue may overwrite newer queue metadata.
7. Once an old computation succeeds, the queue is empty. drainQueueFor checks only pending entries; it does not compare saved financial rows with the approved formula. Deploying a new engine does not enqueue old results automatically.
8. Wallet/finance readers faithfully sum persisted rows. They cannot distinguish an old-policy result from a current one.
9. Timeline reads rows before draining, then renders the old in-memory rows, introducing an additional stale-response issue even when a correct worker runs.

Items 4–6 are confirmed structural flaws from code inspection. They are not claimed as a separately observed concurrent race in this particular incident.

## 5. Scope of the read-only audit

Audited 62 non-VOID ledger rows with work_date >= 2026-09-01, paginated. Screened rows with positive paid minutes below assignment and no custom_minutes. Compared their current source segments with the corrected engine at each row's stored hourly rate.

- 16 candidate differences, all current items DONE and none ledger-LOCKED.
- Staff IDs: T007, T016, T079 and NH079.
- Hypothetical gross increase if every candidate adopted current interpretation: 612,842.533333... VND. **This is not an approved amount owed.** Some legacy records say 30/60/90 minutes assigned but have only 0.5–20 minutes elapsed and no explicit exception marker. Historical test data, old early-finish flows or changed business rules must be resolved before repair.
- Only one candidate in this audit had computed_at after 17:00 UTC on 21 September: the reported T007 row.
- This screening is not a full ledger correctness audit: zero-paid, missing, custom-minute, overpaid, rating/bonus and other-period discrepancies are outside it.

T007 candidates:

| Bill | Assigned | Stored base commission | Current-rule base |
|---|---:|---:|---:|
| 015-21092026 | 45 | 74,438.583333 | 75,000 |
| 010-18092026 | 30 | 49,039.25 | 50,000 |
| 009-12092026 | 60 | 98,942.111111 | 100,000 |
| 004-11092026 | 70 | 114,478.166667 | 116,666.666667 |
| 003-10092026 | 3 | 4,962.444444 | 5,000 |

The 70-minute result uses Type D hourly pricing, not the separate A/B milestone menu. Keep that distinction explicit.

## 6. Recommended rollout — in order

### A. Stop recurrence before repairing money

Inventory every deployment with access to this production database: active branch aliases, immutable old deployments, scheduled jobs and scripts. Patch the active shift-extension calculator using a targeted change, preserving its unrelated work. Verify its source SHA and Ready deployment. Do not merge an entire unrelated branch to move a two-function fix.

Keep only current, approved deployments able to process production financial work. Older deployments must be blocked at the database write boundary; a client-side/environment flag added only to new code cannot stop already-deployed old code. Preview environments should use separate test data where feasible. Do not remove production credentials indiscriminately: map operational users first.

### B. Enforce a minimum writer contract at the database boundary

Introduce a small explicit calculation revision for the approved assigned-duration policy. Record formula_revision and writer_commit on ledger writes. More importantly, add a fail-closed database gate on ledger INSERT/UPDATE/DELETE and queue DELETE so callers without the approved request revision cannot mutate financial results or consume pending work.

Use the per-request PostgREST header `x-ktvd-calculation-revision` as a compatibility signal, passed only by the current writer client, and validate it in a trigger. This is protection against stale builds, not authentication: retain existing service authorization and do not treat a header as a security credential. Existing ledger columns alone are insufficient, because an old update that omits the revision column can leave the new revision attached to an old monetary value.

Test the exact PostgREST request.headers behavior in staging, including the service-role path; do not assume RLS blocks service-role writers. PostgreSQL triggers, not RLS alone, must reject obsolete writes. Scope the new client/header to financial operations. Queue INSERT/UPDATE from source triggers must remain available; the gate must not block ordinary bookings. Backup/restore and approved correction tooling need an explicit audited path.

Roll out migration in two steps: add metadata/support first; deploy current writers; then activate the enforced minimum revision. Never enable enforcement before a working current worker is available.

### C. Commit ledger results and acknowledge queue work atomically

Replace delete-first consumption with an RPC transaction. Claim/read a batch with a generation token, compute in the existing TypeScript engine, then invoke one commit RPC that validates source generation, locks rows, checks LOCKED state, upserts/voids the requested items and acknowledges only matching generations. A source change during computation must leave/requeue the item, not publish a stale result as final. Cover all sibling booking items/guest ratings that influence group/bonus calculations in the generation contract.

No new queue service or second calculation engine is needed. All entry points use the same writer API. Reject an obsolete writer before any delete. Check every DB error and retain pending work on failures.

### D. Repair persisted data after the writer gate is active

Produce a reviewed dry-run manifest containing original row, source segments, old/new paid minutes, gross, bonus, tax, net, revision and reason. Start with confirmed T007 015-21092026 and re-verify the two T027 repairs. Then review the other 15 candidates; do not batch-credit old ambiguous events automatically.

Preserve stored rate/rating/bonus/tax policy snapshots. Do not blindly call loadContext with today's settings to reprice historical work. Apply guarded, idempotent repairs; respect locked settlements with adjustments. Keep durable audit snapshots. A source-data update or concurrent row change must abort that row and request a fresh preview.

Queue emptiness alone is never the completion criterion. Require a current policy revision and compare approved expected amounts against persisted results.

### E. Read fresh values consistently

Drain permitted current work before reading timeline rows. Use staff-based queue discovery so a newly completed item with no ledger row is included. Wallet/finance/history must read the same approved ledger after refresh. Surface recalculation failure as a pending/retry condition rather than silently presenting known stale money as settled. Keep raw decimal amounts through sums; adopt the documented VND display policy consistently at the UI boundary.

## 7. Detailed proposed diffs / contracts (not applied)

### 7.1 Active old branch — existing engine formula

```diff
-import { isVoidedSegment, workedMsOf, parseTimeMs } from '../segment-time';
+import { isVoidedSegment, workedMsOf, parseTimeMs, endedByCounter } from '../segment-time';
@@ computeMinutes, after voided/custom/TAKEOVER guards
- paid += hasMarks ? Math.min(workedMs / 60000, gan) : gan;
+ const completedNormally = hasMarks && workedMs > 0 && !endedByCounter(seg);
+ paid += completedNormally ? gan : hasMarks ? Math.min(workedMs / 60000, gan) : gan;
```

KtvTypeDCommissionService must use `computeMinutes(mySegs).paid * (ratePer60m / 60)` instead of its duplicated per-segment duration loop. This was already done on the other two branches; apply the same focused change here. Keep worked hours separate.

### 7.2 Ledger and queue migration

Proposed new migration and TableInSupabase.md updates:

```sql
ALTER TABLE public."KTVDTurnLedger"
  ADD COLUMN formula_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN writer_commit text;
ALTER TABLE public."KTVDRecomputeQueue"
  ADD COLUMN generation bigint NOT NULL DEFAULT 1;
-- Increment generation on every enqueue conflict, including guest/booking changes.
-- Add minimum-revision gate for ledger mutations and queue acknowledgement.
-- Add transactional commit RPC; revoke PUBLIC/anon/authenticated execution.
-- Existing rows remain revision 0 until independently validated/repaired.
```

Illustrative trigger check, not a complete executable migration:

```sql
headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;
IF coalesce(headers->>'x-ktvd-calculation-revision', '') <> '2' THEN
  RAISE EXCEPTION 'Outdated KTV commission writer';
END IF;
```

Validate absent/empty headers safely in the final implementation. A request revision must match the currently permitted contract, not merely be an arbitrary higher number. Allow only documented maintenance paths; never silently exempt every service-role request, since that is how stale application writers access the ledger.

### 7.3 Writer — atomic persistence

```diff
- await supabase.from('KTVDRecomputeQueue').delete().in('booking_item_id', itemIds);
- return { result: await recomputeTurnRows(supabase, itemIds), failed: 0 };
+ const snapshot = await readQueuedSource(entries); // includes source generations
+ const rows = computeRows(snapshot.bookings, snapshot.staffIds,
+                          snapshot.services, snapshot.configs);
+ return await commitRecomputedRows(rows, snapshot.generations);
```

The two proposed helpers name an RPC contract, not existing implemented functions. commitRecomputedRows uses the revision-tagged financial client, writes formula_revision=2 and writer_commit from the deployment SHA, and invokes one transaction that handles upsert, VOID, lock checks and queue acknowledgement. Errors propagate/are recorded; no pre-delete and no unconditional metadata-overwriting requeue. Diagnostic logs include item ID, revision and commit, without customer data or secrets.

### 7.4 Timeline — read after refresh

```diff
- const { drainQueueFor } = await import('@/lib/services/KtvDLedgerWriter');
+ const { drainQueueForStaff } = await import('@/lib/services/KtvDLedgerWriter');
+ await drainQueueForStaff(supabase, [techCode]);
  const turnRows = await getRows(supabase, {
    staffIds: [techCode], from: GLOBAL_START_DATE_STR, to: '2099-12-31',
  });
- try {
-   await drainQueueFor(supabase, [...new Set(turnRows.map(r => r.booking_id))]);
- } catch { /* ignored */ }
```

Update the drain result contract at all callers so this await cannot silently mean failure. The API should report pending recalculation when refresh failed; never invent zero balances or recompute a conflicting formula in the UI.

### 7.5 Regression and rollout checks

Extend the existing engine test with the exact 45-minute timestamps. Add a focused database integration check for the writer contract (the pure engine suite cannot catch this incident):

1. Old engine proposes 74,438.583; database rejects it and retains the queue entry.
2. Current engine writes 75,000/7,500/67,500 and acknowledges that generation.
3. An old request after the correct write cannot downgrade the row.
4. Source changes between compute and commit: stale result rejected, new work retained.
5. Two workers race: no lost queue generation; final row matches latest source.
6. Locked row cannot be overwritten between the writer's read and commit.
7. Fresh normal 45/60/90-minute completions through each operational deployment produce assigned base pay; no manual patch used to seed expected money.
8. Pauses, multiple technicians, merged services, zero/custom/voided/TAKEOVER/early finish and midnight crossing retain the approved rules.
9. Wallet timeline, history and finance return the same raw row and tax; display policy is tested separately.
10. Verify after an actual scheduled cycle and another permitted read-triggered refresh. Record the resulting formula revision and writer commit, not just the amount.

## 8. Cross-side impact and acceptance

| Area | KTV | Management | Shared mechanism |
|---|---|---|---|
| Base commission | Full own assigned portion on normal completion | Same finance liability | One approved revision at DB write boundary |
| Hours / queue order | Existing actual-hours rules | Existing ranking | No change to actual-minute calculation |
| Bonus / rating / tax | Existing deductions and bonuses | Same snapshots for repair | Preserve policy snapshots |
| Refresh | Current rows or explicit pending status | Same refresh semantics | Atomic commit + generation |
| Old app versions | Cannot overwrite current money | Cannot silently consume financial queue | DB gate applies to all deployments |
| Permissions | Own-account access unchanged | Existing finance access unchanged | RPC privilege review; no new public access |
| Source operations | Completion/pause/handover unchanged | Dispatch still usable | Enqueue remains separate from gated acknowledgement |

Completion means both arithmetic correctness AND control over every writer, followed by reviewed stale-row repair. Merely changing T007's displayed amount, restarting the site, clearing cache, patching one branch or rounding to 75,000 cannot satisfy that criterion.

## 9. What remains unproven

Exact HTTP request/deployment that made the 00:42 write; server-side credential target for every historical immutable deployment; historical intent of large-difference legacy candidates; whether a particular cash payout used the understated balance. The ledger does not currently preserve enough writer provenance to answer the first point from the row alone. These limits do not negate the reproduced old formula or the identified stale-writer paths.
