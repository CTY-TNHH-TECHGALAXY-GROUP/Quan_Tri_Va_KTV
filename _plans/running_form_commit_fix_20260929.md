Người dùng đã duyệt sửa file ổn định trong cuộc hội thoại này. Trước khi sửa, phạm vi thay đổi:

```diff
- IF item.status='IN_PROGRESS' AND options.sequentialSlots='2' THEN
+ IF item.status IN ('IN_PROGRESS','PAUSED') THEN
+   SELECT active running segment (single KTV or sequential A)
+   IF B is active, route A/B edits to the atomic pair RPC
+   ELSE route A duration to the atomic duration RPC
+ END IF

- Per-row running single duration uses a separate RPC and returns before metadata is saved.
+ Per-row running single duration uses the shared whole-form commit, preserving metadata.

+ Add rollback-backed checks for single/paused and A/B whole-form Save/Dispatch.
```
