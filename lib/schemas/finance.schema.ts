import { z } from 'zod';

// POST /api/finance/payroll/override
export const PayrollOverrideSchema = z.object({
  employeeId: z.string().min(1, "Thiếu dữ liệu bắt buộc (employeeId)"),
  employeeName: z.string().optional().nullable(),
  date: z.string().min(1, "Thiếu dữ liệu bắt buộc (date)"),
  newStatus: z.enum(['off', 'suddenOff', 'free', 'request', 'absent'], {
    errorMap: () => ({ message: "Trạng thái (newStatus) không hợp lệ" })
  }),
  reviewedBy: z.string().optional().nullable()
});

// PATCH /api/finance/withdrawals/[id]
export const WithdrawalPatchSchema = z.object({
  adminId: z.string().min(1, "Thiếu thông tin người xử lý (adminId)"),
  adminName: z.string().optional().nullable(),
  status: z.enum(['APPROVED', 'REJECTED'], {
    errorMap: () => ({ message: "Trạng thái không hợp lệ" })
  }),
  note: z.string().optional().nullable()
});

// POST /api/cron/sync-daily-ledger
export const SyncDailyLedgerPostSchema = z.object({
  targetDate: z.string().optional()
});
