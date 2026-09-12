
/**
 * MÔ PHỎNG THUẬT TOÁN ĐIỀU PHỐI & TÍNH TUA (Refactored)
 * Mục tiêu: Chứng minh tính nguyên tử (Atomic), Idempotency và tính tua đúng.
 */

// Giả lập Database State
let db = {
    TurnQueue: [
        { employee_id: 'KTV001', date: '2026-04-30', status: 'waiting', turns_completed: 5, booking_item_ids: [] },
        { employee_id: 'KTV002', date: '2026-04-30', status: 'waiting', turns_completed: 3, booking_item_ids: [] }
    ],
    TurnLedger: [], // UNIQUE(date, booking_id, employee_id)
    BookingItems: [
        { id: 'ITEM_1', bookingId: 'BILL_101', status: 'NEW' },
        { id: 'ITEM_2', bookingId: 'BILL_101', status: 'NEW' }
    ],
    Bookings: [
        { id: 'BILL_101', status: 'NEW' }
    ]
};

function logState(title) {
    console.log(`\n--- ${title} ---`);
    console.log('TurnQueue:', db.TurnQueue.map(q => `${q.employee_id}: ${q.status} (Items: ${JSON.stringify(q.booking_item_ids)})`));
    console.log('TurnLedger Count:', db.TurnLedger.length, db.TurnLedger.map(l => `${l.employee_id} in ${l.booking_id}`));
}

/**
 * Mô phỏng RPC dispatch_confirm_booking
 */
function simulate_dispatch_confirm_booking(bookingId, date, staffAssignments) {
    console.log(`\n[RPC] Executing dispatch_confirm_booking for ${bookingId}...`);
    
    let ledgerInsertedCount = 0;

    for (const assignment of staffAssignments) {
        const ktvId = assignment.ktvId;
        
        // 1. Idempotency Check (Giả lập UNIQUE constraint)
        const alreadyCounted = db.TurnLedger.some(l => l.date === date && l.booking_id === bookingId && l.employee_id === ktvId);
        
        if (!alreadyCounted) {
            // 2. Insert TurnLedger
            db.TurnLedger.push({ date, booking_id: bookingId, employee_id: ktvId, created_at: new Date() });
            ledgerInsertedCount++;
            console.log(`   ✅ Ledger inserted for ${ktvId}`);
        } else {
            console.log(`   ⚠️ Skipping Ledger for ${ktvId} (Already counted)`);
        }

        // 3. Update TurnQueue
        const queueEntry = db.TurnQueue.find(q => q.employee_id === ktvId && q.date === date);
        if (queueEntry) {
            queueEntry.status = 'assigned';
            queueEntry.current_order_id = bookingId;
            // Cập nhật mảng ID
            queueEntry.booking_item_ids = [assignment.bookingItemId];
        }
    }

    // 4. Update BookingItems & Booking
    db.BookingItems.filter(i => i.bookingId === bookingId).forEach(i => i.status = 'PREPARING');
    db.Bookings.find(b => b.id === bookingId).status = 'PREPARING';

    return { success: true, ledgerInserted: ledgerInsertedCount };
}

/**
 * Mô phỏng Start Service (Chuyển assigned -> working)
 */
function simulate_start_service(bookingId) {
    console.log(`\n[Action] Starting service for ${bookingId}...`);
    
    db.TurnQueue.filter(q => q.current_order_id === bookingId).forEach(q => {
        if (q.status === 'assigned') {
            q.status = 'working';
            console.log(`   🚀 KTV ${q.employee_id} status changed to WORKING`);
        }
    });
    
    db.BookingItems.filter(i => i.bookingId === bookingId).forEach(i => i.status = 'IN_PROGRESS');
    db.Bookings.find(b => b.id === bookingId).status = 'IN_PROGRESS';
}

// --- CHẠY KỊCH BẢN ---

logState('Trạng thái Ban đầu');

// 1. Dispatch lần 1
const assignments = [{ ktvId: 'KTV001', bookingItemId: 'ITEM_1' }];
simulate_dispatch_confirm_booking('BILL_101', '2026-04-30', assignments);
logState('Sau khi Dispatch lần 1');

// 2. Dispatch lần 2 (Double click / Retry) -> Test Idempotency
console.log('\n--- TEST IDEMPOTENCY (Bấm nút lần 2) ---');
simulate_dispatch_confirm_booking('BILL_101', '2026-04-30', assignments);
logState('Sau khi Dispatch lần 2 (Không được tăng Ledger)');

// 3. KTV bắt đầu làm
simulate_start_service('BILL_101');
logState('Sau khi Bắt đầu làm (Assigned -> Working)');

console.log('\n✅ KẾT LUẬN MÔ PHỎNG:');
console.log('1. Tua được ghi nhận ngay khi Dispatch (Ledger Count = 1).');
console.log('2. Bấm lặp lại không làm tăng số lượng bản ghi Ledger (An toàn).');
console.log('3. Trạng thái Assigned giúp tách biệt việc "giữ chỗ" và "đang làm".');
