const { z } = require('zod');

// Giả lập lại schema đã cấu hình
const AttendanceSchema = z.object({
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

console.log("========== 🧪 BẮT ĐẦU MÔ PHỎNG TEST ZOD VỚI KTV NH079 ==========\n");

// Test Case 1: Dữ liệu chuẩn
console.log("🟢 Test Case 1: Điểm danh hợp lệ (Dữ liệu chuẩn)");
const payload1 = {
  employeeId: 'NH079',
  employeeName: 'Nguyễn Văn Test',
  checkType: 'CHECK_IN',
  latitude: 10.123,
  longitude: 106.123
};
const res1 = AttendanceSchema.safeParse(payload1);
if (res1.success) {
  console.log("✅ Thành công! Dữ liệu đã được chuẩn hóa:");
  console.log(res1.data);
} else {
  console.error("❌ Thất bại:", res1.error.issues);
}
console.log("\n---------------------------------------------------------------\n");

// Test Case 2: Cố tình gửi sai checkType
console.log("🔴 Test Case 2: Điểm danh sai checkType (Frontend gửi nhầm 'CHECK_XYZ')");
const payload2 = {
  employeeId: 'NH079',
  checkType: 'CHECK_XYZ' // Không nằm trong Enum
};
const res2 = AttendanceSchema.safeParse(payload2);
if (!res2.success) {
  console.log("✅ Zod đã bắt lỗi thành công, API sẽ văng lỗi 400:");
  console.log("Lỗi:", res2.error.issues[0].message, "ở field", res2.error.issues[0].path);
}
console.log("\n---------------------------------------------------------------\n");

// Test Case 3: Không gửi mã nhân viên
console.log("🔴 Test Case 3: Thiếu mã nhân viên (employeeId rỗng hoặc thiếu)");
const payload3 = {
  employeeId: '',
  checkType: 'CHECK_IN'
};
const res3 = AttendanceSchema.safeParse(payload3);
if (!res3.success) {
  console.log("✅ Zod đã bắt lỗi thành công, API sẽ văng lỗi 400:");
  console.log("Lỗi:", res3.error.issues[0].message);
}

console.log("\n======================== HOÀN TẤT ========================");
