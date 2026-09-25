# Implementation Plan: Deep Sequential Timeline Synchronization (Option B)

This plan outlines the steps to implement database-level synchronization for sequential KTV timelines, ensuring that KTV Dashboards and other system components see accurate, real-time start/end times.

## 1. Create Server-Side Timeline Sync Utility
Create a function `syncOrderTimelineToDb(bookingId)` in `app/reception/dispatch/actions.ts`.

### Logic:
1. Fetch all `BookingItems` for the given `bookingId`.
2. Extract all staff segments across all items.
3. Sort segments by their current `startTime`.
4. Iterate through segments:
    - For the first segment: Use its current `actualStartTime` if available, else its `startTime`.
    - For subsequent segments: 
        - If they share the same original `startTime` (Four-hand), they share the same calculated start.
        - If they are sequential, the new `startTime` = `actualEndTime` or (`actualStartTime` + `duration`) of the previous group.
5. If the calculated `startTime` differs from the stored `startTime`, update the `segments` JSON and save back to `BookingItems`.
6. **Important:** Also update the `timeStart` field of the `BookingItem` if it's the first segment of that item being shifted.

## 2. Integrate into Update Flows
Call `syncOrderTimelineToDb(bookingId)` in the following `actions.ts` functions:
- `updateBookingItemStatus`: After updating status to `IN_PROGRESS`, `CLEANING`, or `DONE`.
- `processDispatch`: After successful RPC execution.
- `saveDraftDispatch`: After saving manual edits.
- `splitBookingItem`: Ensure the split items are correctly chained.

## 3. Fix "Jump to Preparing" Issue
In `processDispatch`, check the current status of the order/items before defaulting to `PREPARING`. 
- If `dispatchData.status` is not provided, do not overwrite the existing status.
- Ensure the RPC `dispatch_confirm_booking` does not unconditionally reset statuses to `PREPARING`.

## 4. Optimize Notifications
In `processDispatch`, only send `NEW_ORDER` notifications to staff who were NOT previously assigned or if the order is transitioning from `pending` to `PREPARING`.
- Prevent redundant notifications when Lễ tân simply clicks "Save" to adjust times or notes.

## 5. UI Improvements (Manual Save)
Ensure the "Save" button in the Dispatch Modal correctly triggers the updated `processDispatch` or `saveDraftDispatch` which now includes the timeline sync.

---

### Regression Prevention:
- Ensure Four-hand services (same start time) do not get accidentally sequenced.
- Maintain `actualStartTime` integrity (never overwrite an existing `actualStartTime` with a calculated one).
- Verify that midnight-crossing logic is preserved in the server-side calculation.
