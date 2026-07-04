import { z } from 'zod';

// Schema cho API Điểm danh (POST /api/ktv/attendance)
export const AttendanceSchema = z.object({
  employeeId: z.string().min(1, "Thiếu mã hoặc ID nhân viên"),
  employeeName: z.string().optional(),
  checkType: z.enum(['CHECK_IN', 'LATE_CHECKIN', 'CHECK_OUT', 'SUDDEN_OFF', 'OFF_REQUEST']).default('CHECK_IN'),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  locationText: z.string().optional().nullable(),
  photoBase64: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  reason: z.string().optional().nullable(),
  selectedShiftType: z.string().optional().nullable(),
  estimatedEndTime: z.string().optional().nullable(),
  wantsToWithdraw: z.boolean().optional().default(false)
});

// Schema cho API Yêu cầu/Gán ca làm việc (POST /api/ktv/shift)
export const ShiftRequestSchema = z.object({
  employeeId: z.string().min(1, "Missing required field: employeeId"),
  employeeName: z.string().optional(),
  shiftType: z.enum(['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'], {
    message: "Invalid shiftType. Must be SHIFT_1, SHIFT_2, SHIFT_3, FREE, or REQUEST"
  }),
  reason: z.string().optional().nullable(),
  assignedByAdmin: z.boolean().optional(),
  adminId: z.string().optional().nullable(),
  estimatedEndTime: z.string().optional().nullable()
});

// Schema cho API Duyệt/Từ chối yêu cầu đổi ca (PATCH /api/ktv/shift)
export const ShiftPatchSchema = z.object({
  shiftId: z.string().min(1, "Missing shiftId"),
  action: z.enum(['APPROVE', 'REJECT'], {
    message: "action must be APPROVE or REJECT"
  }),
  adminId: z.string().optional().nullable()
});

// Schema cho API Xin nghỉ phép (POST /api/ktv/leave)
export const LeaveRequestSchema = z.object({
  employeeId: z.string().min(1, "Missing required fields: employeeId"),
  employeeName: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  dates: z.array(z.string()).optional(),
  reason: z.string().optional().nullable(),
  confirmExtension: z.boolean().optional(),
  confirmSuddenOff: z.boolean().optional(),
  registeredByAdmin: z.boolean().optional()
});

// Schema cho API Duyệt/Từ chối nghỉ phép (PATCH /api/ktv/leave)
export const LeavePatchSchema = z.object({
  leaveId: z.string().min(1, "Missing leaveId"),
  action: z.enum(['APPROVE', 'REJECT'], {
    message: "action must be APPROVE or REJECT"
  }),
  adminId: z.string().optional().nullable()
});

// Schema cho API Đánh giá KTV (POST /api/ktv/review)
export const KtvReviewSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  techCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

// Schema cho API Rút tiền (POST /api/ktv/wallet/withdraw)
export const KtvWalletWithdrawSchema = z.object({
  techCode: z.string().min(1, "Dữ liệu không hợp lệ"),
  amount: z.coerce.number().positive("Số tiền phải lớn hơn 0"),
  walletType: z.string().optional().default('TUA')
});

// Schema cho API Push Sync (POST /api/ktv/push-sync)
export const KtvPushSyncSchema = z.object({
  staffId: z.string().min(1, "staffId is required"),
  subscription: z.any(),
  userAgent: z.string().optional()
});

// Schema cho API Push Unsubscribe (POST /api/ktv/push-unsubscribe)
export const KtvPushUnsubscribeSchema = z.object({
  staffId: z.string().min(1, "staffId is required"),
  endpoint: z.string().min(1, "endpoint is required")
});

// Schema cho API Xác nhận điểm danh (PATCH /api/ktv/attendance/confirm)
export const KtvAttendanceConfirmSchema = z.object({
  attendanceId: z.string().min(1, "Missing attendanceId"),
  action: z.enum(['CONFIRM', 'REJECT'], {
    message: "action must be CONFIRM or REJECT"
  }),
  adminId: z.string().optional().nullable()
});

// Schema cho API Nhập Tip (POST /api/ktv/history)
export const KtvHistoryTipSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  techCode: z.string().min(1, "techCode is required"),
  tip: z.coerce.number().nonnegative("tip must be >= 0")
});

// Schema cho API Booking PATCH Orchestrator (PATCH /api/ktv/booking)
export const KtvBookingPatchSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  status: z.string().min(1, "status is required"),
  action: z.string().optional(),
  techCode: z.string().optional()
});

// Schema cho API Interaction (POST /api/ktv/interaction)
export const KtvInteractionSchema = z.object({
  bookingId: z.string().min(1, "bookingId is required"),
  type: z.enum(['WATER', 'SUPPORT', 'EMERGENCY', 'BUY_MORE', 'EARLY_EXIT'], {
    message: "type is required"
  }),
  techCode: z.string().optional(),
  message: z.string().optional()
});

