# Type D 90-minute commission: investigation and proposed fix

Date: 2026-09-21. Updated after user approval: normal completion earns the full assigned service duration.

## Approved implementation update

The user explicitly replaced the proposed one-second tolerance below with full assigned-duration pay for normal completion. The original investigation is retained below as evidence; its tolerance proposal and timeline diff are superseded/not applied.

- KtvDLedgerEngine.computeMinutes pays each normally completed segment's assigned duration, provided its recorded worked interval is positive. Existing missing-timestamp fallback is retained.
- Existing endedByCounter markers retain elapsed-time pay; customCommissionDuration (including zero), voided segments and the unfinished TAKEOVER gate remain authoritative.
- KtvTypeDCommissionService delegates duration calculation to computeMinutes so legacy callers follow the same rule and exception guards.
- Actual hours and queue priority remain based on the existing worked-hours calculation. Ratings, bonuses and tax still apply after base commission.
- No timestamp, schema, auth, handover, room duty, rating attribution, notification, display-formatting or timeline-refresh changes.
- Effect on both KTV wallet/history and management Type D finance: shared ledger calculation produces full base commission; existing refresh/recompute mechanisms deliver the new values after deployment.
- Production ledger values have not been backfilled. Locked settlements must retain their existing adjustment process. Deploying this rule can change unlocked old rows when existing recomputation jobs process them.

The implementation tests cover the real 725 ms case, a substantial shortfall on normal completion, genuine counter closure, overrides, zero/voided work, replacement, pause accounting, merged portions, multiple technicians, tax and reader parity.

Validation completed: 81 engine assertions, 39 pause/exception assertions and 7 legacy commission assertions passed (127 total). The engine suite also passed under TZ=UTC. Focused strict TypeScript checking of the changed calculators and commission tests passed; git diff --check passed. Existing engine test configuration was completed with explicit disabled bonus settings required by TypeDConfigs. No full application build or live financial backfill was run.


## 1. Finding

The 149,979 display is reproducible. A service recorded as 89 minutes 59.275 seconds is paid proportionally, although its assigned and rounded actual durations both show 90 minutes. At 100,000 VND/hour, the missing 725 milliseconds removes 20.138888… VND before tax. The wallet then truncates 149,979.861111… to 149,979.

Account clarification: the matching live record is **T027**, bill **006-21092026**, item `11NDK-006-21092026-item1`, service `NHS1010`. T007 is TYPE_D, but its current 90-minute FINAL record, bill **024-14092026**, service `NHS0010`, correctly stores 150,000 gross and 15,000 tax. No 149,979 commission was found among the 19 T007 ledger rows returned (including a VOID row and a test hours row). This establishes the mechanism and a matching real record; it does not establish that the same amount currently appears under T007 in the deployed browser.

The application calls the deduction **Thuế TNCN**, with a hardcoded rate of 10% and configured effective date 2026-09-01. This report describes application behavior, not tax-law advice. The 150,000 here is KTV commission for standard services, not the customer-facing Services.price or invoice VAT.

## 2. Exact arithmetic

T027 timestamps, UTC:

- Start: `2026-09-21T08:51:23.748Z`.
- End: `2026-09-21T10:21:23.023Z`.
- Assigned: 90 minutes = 5,400,000 ms.
- Recorded work: 5,399,275 ms; no pauses or custom override in the returned segment.
- Paid: 89.98791666666666 minutes.
- Rate: 100,000 VND / 60 minutes, confirmed in SystemConfigs and ledger.

| Value | Current stored calculation | Wallet display | Proposed full-duration result |
|---|---:|---:|---:|
| Gross commission | 149,979.861111… | 149,979 | 150,000 |
| Tax, 10% | 14,997.986111… | 14,997 | 15,000 |
| Net, excluding unrelated amounts | 134,981.875 | 134,981 | 135,000 |

Correcting this duration adds 20.138888… gross, 2.013888… tax, and 18.125 net VND. It must not add 21 VND directly to the wallet: 21 is a difference between displayed integers, not the underlying financial correction.

T007's 90-minute record provides a control: start 14:18:17.209Z, end 15:49:05.120Z, pause 46.939 seconds. Net work is 90 minutes 0.972 seconds, capped to 90 paid minutes, yielding exactly 150,000.

## 3. Code path and root cause

1. `app/api/ktv/booking/_handlers/handleFinishService.ts`: normal completion records server `nowISO` as actualEndTime. Merged services allocate elapsed time proportionally. There is no distinction here between a tiny timing shortfall and financially meaningful early completion.
2. `lib/segment-time.ts:workedMsOf`: computes end minus start minus pauses, preserving milliseconds.
3. `lib/services/KtvDLedgerEngine.ts:computeMinutes`: money uses `min(workedMs / 60000, assigned)`; actual minutes use `min(round(workedMs / 60000), assigned)`. The same interval therefore becomes 89.9879167 paid minutes but 90 displayed actual minutes.
4. `computeRows` multiplies paid minutes by hourly rate / 60, applies rating deductions, and then bonus/tax logic. Decimal monetary values are deliberately retained for aggregation.
5. `KtvDLedgerWriter` persists the result in KTVDTurnLedger. `KtvDLedgerReader` feeds wallet, timeline, history and the Type D finance summary.
6. `lib/format.logic.ts:formatVnd` truncates decimal VND for display; the wallet page uses it.

This is a duration-policy mismatch: completed nominal services can lose small amounts because payment uses millisecond precision. It is not explained by a wrong hourly rate, customer VAT, or ordinary floating-point error. The 725 ms difference exists in the stored timestamps themselves.

The reason the two timestamps are 725 ms short is not proven. Browser/server clock offset, finish timing, or another completion path are candidates, not established findings. The current UI timer uses absolute time with a clock offset and whole-second elapsed values; that alone does not prove a specific timer defect. Do not rewrite timestamps to conceal the shortfall.

## 4. Additional findings within this flow

### A. History and wallet use different presentation rules

History route rounds ledger amounts with Math.round, while wallet formatVnd truncates. The same gross can show 149,980 in history and 149,979 in wallet. Neither display restores the intended 150,000. This is a separate presentation inconsistency; changing the formatter alone leaves the actual underpayment in the ledger.

Keep raw precision through all sums and select one documented display policy. The established wallet policy is truncation. A follow-up should move history truncation to the presentation boundary, including commission, bonus, deduction, tax, net and summaries; do not calculate net by subtracting already truncated display values. Individually truncated entries can legitimately differ from a truncated aggregate by small amounts.

### B. Timeline reads before refreshing the queue

In `app/api/ktv/wallet/timeline/route.ts`, the Type D branch reads turnRows, calls drainQueueFor, and then renders the original turnRows. A recomputed amount can remain stale in that response. Query again after a successful drain. This is a confirmed code-order problem, but not proof of why the user named T007.

The refresh is also seeded only from bookings already present in turnRows; that does not discover a newly completed booking with no ledger row. Fixing initial-row discovery requires checking queue selection separately and must not be claimed as solved by a second read.

### C. Type D hourly pay differs from A/B milestone pricing

TYPE_D uses configured 100,000/hour for PT. The separate A/B milestone map includes 70 minutes = 115,000 and 100 minutes = 165,000; Type D currently calculates 116,666.666… and 166,666.666…. T007 has examples of both durations. At 90 minutes, both rules happen to give 150,000. Do not replace Type D with the A/B milestone map as a fix for this incident: that would change other earnings rules.

### D. Legacy calculators still exist

KtvTypeDCommissionService.calculateGuestCommission also uses fractional elapsed minutes, but lacks the engine's pause handling and TAKEOVER completion gate. It has callers in daily-ledger cron routes and a later wallet-timeline branch. The active Type D timeline takes the earlier ledger branch. Assess caller reachability and legacy ledger consumers before consolidating; blindly routing the new engine through that legacy calculator would regress existing protections.

## 5. Recommended fix and limits

Adopt an explicit **one-second completion tolerance**, applied only when positive worked time is within one second of assigned duration. This is a proposed business rule, not a rule already established by the code. It directly covers the observed 725 ms case and limits additional credit to one second per eligible segment. It retains proportional pay for larger shortfalls, explicit custom durations, zero work, voided segments, pauses and unfinished TAKEOVER segments.

Do not round every service to whole minutes: that changes genuine early-finish payments by as much as roughly half a minute per segment. Do not automatically pay full assigned time for every DONE item: DONE can also represent an approved early finish. If the intended rule is full menu commission for all normal completions regardless of timestamp, that needs an explicit completion-reason distinction and a broader plan.

The tolerance covers duration drift; it does not establish or fix the source of clock drift. Merged-service allocation can distribute shortfalls across segments, so its tests must enforce the per-segment limit and document the resulting aggregate allowance.

## 6. Proposed diffs — NOT applied

### Primary correction: KtvDLedgerEngine.ts, computeMinutes

```diff
-        // TIỀN — phút lẻ, mốc lỗi trả 0, chặn tại giờ gán
-        paid += hasMarks ? Math.min(workedMs / 60000, gan) : gan;
+        // Credit a completed duration when timestamp shortfall is at most one second.
+        const shortfallMs = hasMarks ? gan * 60000 - workedMs : Infinity;
+        const completedWithinTolerance = hasMarks && workedMs > 0
+            && shortfallMs >= 0 && shortfallMs <= 1000;
+        paid += completedWithinTolerance
+            ? gan
+            : hasMarks ? Math.min(workedMs / 60000, gan) : gan;
```

This remains after the existing voided/custom/TAKEOVER guards and after pause subtraction. No rate, rating, tax, bonus, timestamp or hours formula is changed. Keep the existing decimal money aggregation. TypeScript narrowing and existing tests must pass when this patch is implemented.

### Timeline consistency: wallet/timeline/route.ts, Type D branch

```diff
-            const turnRows = await getRows(supabase, {
+            let turnRows = await getRows(supabase, {
                 staffIds: [techCode], from: GLOBAL_START_DATE_STR, to: '2099-12-31',
             });
 ...
                 await drainQueueFor(supabase, [...new Set(turnRows.map(r => r.booking_id))]);
+                turnRows = await getRows(supabase, {
+                    staffIds: [techCode], from: GLOBAL_START_DATE_STR, to: '2099-12-31',
+                });
```

Additional DB read per successful refresh; unchanged fallback if drain fails. This is separate from the financial correction and can be reviewed independently.

### Tests and historical repair

- Add regression cases to existing `scripts/simulate_ktvd_ledger_engine.ts`, using the exact T027 timestamps. No new testing framework.
- Cover 0, 725, 1000 and 1001 ms shortfalls, overrun, zero/invalid timestamps, custom=0, voided, paused, unfinished TAKEOVER, merged services and midnight crossing.
- Verify the proposed 725 ms result is paid=90, gross=150000, tax=15000, net=135000; the T007 control remains unchanged.
- Run existing engine and pause simulations, then check wallet/history/finance from the same ledger fixture and date range.
- Prepare a read-only before/after audit of affected real rows using the new engine. Include item, staff, work date, old/new gross, tax, net, status and lock state. Avoid recomputing all historical data using today's rates without validating historical configuration.
- Recompute only reviewed, affected, unlocked rows through the existing writer. Preserve LOCKED records; use the established adjustment process for settled corrections. Existing writer explicitly skips entry_status=LOCKED.
- Keep original rows for a reversible data repair. Reverting code alone cannot undo ledger values already recomputed.

## 7. Cross-side impact

| Area | KTV side | Management side | Shared source / conclusion |
|---|---|---|---|
| Commission | Wallet, timeline, history receive corrected gross/net | Type D finance summaries receive corrected totals | KTVDTurnLedger; one engine correction |
| Hours / queue | Existing rounded actual minutes preserved | Existing ranking/order preserved | No proposed hours change |
| Refresh | Timeline reads again after queue drain | Finance obtains ledger totals on refresh | No new realtime subscription proposed |
| Display | History rounds; wallet truncates | Verify finance formatting against same totals | Follow-up display consistency work |
| Access | Existing authenticated account filters preserved | Existing finance authorization preserved | No permissions change |
| Past settlements | May require adjustment rather than overwrite | Auditable correction required | Respect existing LOCKED guard |

## 8. Validation actually performed

Read-only Supabase queries confirmed T007's type and ledger rows, the matching T027 row and timestamps, configured PT rate and tax effective date. A local Node reproduction loaded the actual TypeScript computeMinutes and formatVnd implementations through the installed TypeScript transpiler. Assertions confirmed actual=90 and formatted gross=`149.979đ`; printed net=134981.875. No production mutations, app login, browser reproduction, deployment, or implementation tests for the proposed changes were performed.

The deliverable is the requested report, fix plan and proposed diff. Application changes and financial backfill are not applied.
