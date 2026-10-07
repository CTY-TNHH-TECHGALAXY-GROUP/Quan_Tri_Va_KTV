# Vercel TEST Hobby preview — thay đổi riêng trên branch test

Base: `e5075464`. Branch: `test/sequential-two-slot-handoff-20260928`.

Project Vercel TEST dùng Hobby, không chấp nhận cron chạy nhiều lần mỗi ngày. Bản preview chỉ cần thao tác điều phối; cron sẽ không chạy trên branch test. Branch tính năng gốc giữ nguyên `vercel.json`.

```diff
diff --git a/vercel.json b/vercel.json
--- a/vercel.json
+++ b/vercel.json
@@ -1,36 +1,3 @@
 {
-  "crons": [
-    {
-      "path": "/api/cron/sync-daily-ledger",
-      "schedule": "0 19 * * *"
-    },
-    {
-      "path": "/api/cron/sync-daily-ledger-type-d",
-      "schedule": "30 0 * * *"
-    },
-    {
-      "path": "/api/cron/ktvd-recompute",
-      "schedule": "*/5 * * * *"
-    },
-    {
-      "path": "/api/cron/cleanup-online",
-      "schedule": "0 2,4,8,10,12,14,17 * * *"
-    },
-    {
-      "path": "/api/cron/reset-type-d-hours",
-      "schedule": "0 17 1 * *"
-    },
-    {
-      "path": "/api/cron/daily-absence-check?mode=lock-unregistered",
-      "schedule": "0 17 * * *"
-    },
-    {
-      "path": "/api/cron/type-d-registration-reminder",
-      "schedule": "0 14 * * *"
-    },
-    {
-      "path": "/api/cron/type-d-pending-lock",
-      "schedule": "*/5 * * * *"
-    }
-  ]
+  "crons": []
 }
```

User đã cho phép sửa file ổn định bằng câu “Duyệt sửa file ổn định” trong phiên này.
