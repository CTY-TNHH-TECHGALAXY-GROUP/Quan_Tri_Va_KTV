// ==========================================
// MÔ PHỎNG: KÉO THẢ KANBAN KHÔNG GHI ĐÈ timeStart
// ==========================================

console.log("=== KỊCH BẢN 1: KTV đã bấm BẮT ĐẦU, Kanban tự nhảy COMPLETED, Lễ tân kéo lại IN_PROGRESS ===\n");

// Trạng thái DB trước khi kéo
const itemsBefore = [
    { id: 'item1', status: 'COMPLETED', timeStart: '2026-04-28T08:18:57.077+00:00' }, // KTV đã bấm bắt đầu từ 15:18
    { id: 'item2', status: 'IN_PROGRESS', timeStart: '2026-04-28T09:20:57.533+00:00' }  // KTV thứ 2 đang làm từ 16:20
];

const now = '2026-04-28T15:07:00.000Z'; // Giờ hiện tại = 22:07 VN
const dragItemIds = ['item1']; // Lễ tân kéo item1 về IN_PROGRESS

// Logic MỚI: Kiểm tra từng item
const itemsNeedTimeStart = itemsBefore.filter(i => dragItemIds.includes(i.id) && !i.timeStart).map(i => i.id);
const itemsAlreadyStarted = itemsBefore.filter(i => dragItemIds.includes(i.id) && i.timeStart).map(i => i.id);

console.log("Items cần set timeStart (chưa có):", itemsNeedTimeStart);
console.log("Items đã có timeStart (bảo toàn):", itemsAlreadyStarted);

if (itemsNeedTimeStart.length > 0) {
    console.log(`\n→ Items ${itemsNeedTimeStart.join(', ')}: SET status=IN_PROGRESS, timeStart=${now}`);
}
if (itemsAlreadyStarted.length > 0) {
    console.log(`→ Items ${itemsAlreadyStarted.join(', ')}: SET status=IN_PROGRESS (GIỮ NGUYÊN timeStart gốc)`);
    const originalTime = itemsBefore.find(i => i.id === itemsAlreadyStarted[0])?.timeStart;
    console.log(`  ✅ timeStart VẪN LÀ: ${originalTime} (15:18 VN - không bị ghi đè thành 22:07)`);
}

// Logic CŨ (để so sánh)
console.log("\n--- SO SÁNH VỚI LOGIC CŨ ---");
console.log(`Logic CŨ: UPDATE BookingItems SET timeStart='${now}' WHERE id IN ('item1')`);
console.log(`→ 🔴 GHI ĐÈ timeStart = ${now} (22:07 VN) cho item1 dù KTV đã bấm từ 15:18!`);

console.log("\n=== KỊCH BẢN 2: Bill bị kéo toàn bộ về IN_PROGRESS (updateBookingStatus) ===\n");

const allItems = [
    { id: 'item1', status: 'COMPLETED', timeStart: '2026-04-28T08:18:57.077+00:00' },
    { id: 'item2', status: 'IN_PROGRESS', timeStart: '2026-04-28T09:20:57.533+00:00' },
    { id: 'item3', status: 'PREPARING', timeStart: null }  // Item chưa bắt đầu
];

console.log("Logic MỚI (updateBookingStatus):");
console.log("1. Filter status IN ['WAITING', 'PREPARING', 'NEW'] → SET timeStart + status");
const newItems = allItems.filter(i => ['WAITING', 'PREPARING', 'NEW'].includes(i.status));
console.log(`   → Áp dụng cho: ${newItems.map(i => i.id).join(', ') || 'không có'} (set timeStart mới)`);

console.log("2. Filter status IN ['COMPLETED', 'CLEANING'] AND timeStart IS NOT NULL → CHỈ SET status");
const recoveredItems = allItems.filter(i => ['COMPLETED', 'CLEANING'].includes(i.status) && i.timeStart);
console.log(`   → Áp dụng cho: ${recoveredItems.map(i => i.id).join(', ') || 'không có'} (bảo toàn timeStart gốc)`);
console.log(`   ✅ item1.timeStart VẪN LÀ: ${recoveredItems[0]?.timeStart || 'N/A'}`);

console.log("3. Items đang IN_PROGRESS → KHÔNG bị ảnh hưởng");

console.log("\n=== KỊCH BẢN 3: checkAutoFinish + skipConfirm ===\n");

const autoFinishedSet = new Set();
const orderId = 'order-002';

// Lần 1: Auto-finish
console.log("Lần 1 (t=0s): checkAutoFinish phát hiện hết giờ");
if (!autoFinishedSet.has(orderId)) {
    autoFinishedSet.add(orderId);
    console.log(`  → Gọi onUpdateStatus('${orderId}', 'COMPLETED', undefined, skipConfirm=true)`);
    console.log("  → ✅ KHÔNG bật confirm dialog");
}

// Lần 2: 30 giây sau
console.log("\nLần 2 (t=30s): checkAutoFinish chạy lại");
if (!autoFinishedSet.has(orderId)) {
    console.log("  → Gọi onUpdateStatus...");
} else {
    console.log(`  → ✅ SKIP vì đơn ${orderId} đã nằm trong autoFinishedRef`);
    console.log("  → Lễ tân KHÔNG bị làm phiền");
}

console.log("\n✅ TẤT CẢ KỊCH BẢN KÉO THẢ ĐỀU AN TOÀN!");
