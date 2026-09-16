// Test script: Simulate attendance check-in for a KTV with laundry deduction flag
// Run: node scripts/test-laundry-deduction.mjs

const BASE_URL = 'http://localhost:3000';

// ⚠️ Thay employeeId bằng UUID của KTV test (lấy từ bảng Users)
// Ví dụ: KTV NH007 có Users.id = ???
// Chạy SQL trước: SELECT id, code, "fullName" FROM "Users" WHERE code = 'NH007';
const TEST_EMPLOYEE_ID = 'THAY_BANG_UUID_CUA_NH007';

async function testCheckIn() {
    console.log('🧪 Testing CHECK_IN for employee:', TEST_EMPLOYEE_ID);
    console.log('---');

    const res = await fetch(`${BASE_URL}/api/ktv/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            employeeId: TEST_EMPLOYEE_ID,
            checkType: 'CHECK_IN',
            latitude: 10.762622,
            longitude: 106.660172,
            locationText: 'Test Script',
        }),
    });

    const data = await res.json();
    console.log('📍 Attendance Response:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log('\n✅ Điểm danh thành công!');
        console.log('👉 Kiểm tra bảng WalletAdjustments trong Supabase:');
        console.log('   SELECT * FROM "WalletAdjustments" WHERE staff_id = \'NH007\' ORDER BY created_at DESC LIMIT 5;');
        console.log('\n👉 Nếu thấy dòng "Trừ tiền giặt đồ" với amount = -20000 → THÀNH CÔNG! 🎉');
    } else {
        console.log('\n❌ Điểm danh thất bại:', data.error);
    }
}

testCheckIn().catch(console.error);
