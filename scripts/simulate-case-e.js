/**
 * 🧪 SIMULATION: Case E — 1 KH + 2 DV + 1 KTV
 * 
 * Mô phỏng flow: Admin gán NH002 cho 2 dịch vụ (Tinh dầu + Chăm sóc da mặt)
 * → KTV NH002 bấm Start → Cả 2 DV đều bị set timeStart/timeEnd giống nhau
 * 
 * Root Cause Analysis:
 */

console.log('═══════════════════════════════════════════════════════════');
console.log('🧪 Case E: 1 KH + 2 DV + 1 KTV — Mô phỏng bug thời gian');
console.log('═══════════════════════════════════════════════════════════');

// ─── MOCK DATA: Trạng thái sau khi Admin dispatch ──────────────────────

const booking = {
    id: 'booking-001',
    status: 'PREPARING',
    technicianCode: 'NH002',
    timeStart: null,
    timeEnd: null,
};

const bookingItems = [
    {
        id: 'item-1',
        bookingId: 'booking-001',
        serviceId: 'tinh-dau',
        service_name: 'Tinh dầu',
        duration: 2, // 2 phút
        technicianCodes: ['NH002'],
        timeStart: null,
        timeEnd: null,
        status: 'PREPARING',
        segments: JSON.stringify([
            { ktvId: 'NH002', duration: 2, startTime: '10:56', endTime: '10:58', roomId: 'P.V1' }
        ])
    },
    {
        id: 'item-2',
        bookingId: 'booking-001',
        serviceId: 'cham-soc-da-mat',
        service_name: 'Chăm sóc da mặt',
        duration: 3, // 3 phút
        technicianCodes: ['NH002'],
        timeStart: null,
        timeEnd: null,
        status: 'PREPARING',
        segments: JSON.stringify([
            { ktvId: 'NH002', duration: 3, startTime: '10:58', endTime: '11:01', roomId: 'P.V1' }
        ])
    }
];

const turnQueue = {
    employee_id: 'NH002',
    current_order_id: 'booking-001',
    booking_item_id: 'item-1,item-2', // Cả 2 items
    status: 'working',
};

console.log('\n📋 Trạng thái TRƯỚC khi KTV bấm Start:');
console.log('  Booking:', booking.status, '| timeStart:', booking.timeStart);
bookingItems.forEach(item => {
    console.log(`  ${item.service_name}: status=${item.status}, timeStart=${item.timeStart}, timeEnd=${item.timeEnd}`);
});

// ─── SIMULATE: KTV NH002 bấm "Bắt Đầu" (START_TIMER) ─────────────────

console.log('\n🔥 ========== KTV NH002 BẤM "BẮT ĐẦU" ==========');
console.log('   → PATCH /api/ktv/booking { status: IN_PROGRESS, action: START_TIMER }');

// Simulate what the API does (lines 288-441 of route.ts)
const sharedTimeStart = new Date('2026-04-29T03:56:00.000Z').toISOString(); // 10:56 VN
const technicianCode = 'NH002';

// Step 1: Find all items for this KTV
const allItemIdsForThisKTV = bookingItems
    .filter(item => item.technicianCodes.includes(technicianCode))
    .map(item => item.id);

console.log('\n   📍 allItemIdsForThisKTV:', allItemIdsForThisKTV);
console.log('   (cả 2 items đều gán cho NH002)');

// Step 2: Process segments (lines 340-431)
const itemSegmentsMap = new Map();
let allGlobalSegs = [];

for (const item of bookingItems) {
    const segs = JSON.parse(item.segments);
    itemSegmentsMap.set(item.id, segs);
    
    segs.forEach((seg, idx) => {
        if (seg.ktvId && seg.ktvId.toLowerCase().includes(technicianCode.toLowerCase())) {
            allGlobalSegs.push({ item, localIdx: idx, seg });
        }
    });
}

// Sort by startTime
allGlobalSegs.sort((a, b) => {
    const timeA = a.seg.startTime || '23:59';
    const timeB = b.seg.startTime || '23:59';
    return timeA.localeCompare(timeB);
});

console.log('\n   📍 Global Segments (sorted by startTime):');
allGlobalSegs.forEach((gs, i) => {
    console.log(`     [${i}] ${gs.item.service_name}: ${gs.seg.startTime}-${gs.seg.endTime} (${gs.seg.duration}p)`);
});

// Step 3: START_TIMER → Set actualStartTime on first global segment ONLY
console.log('\n   ⚡ action=START_TIMER → allGlobalSegs[0].seg.actualStartTime = sharedTimeStart');
allGlobalSegs[0].seg.actualStartTime = sharedTimeStart;

// Step 4: 🐛 BUG IS HERE — shouldUpdateItemTimeStart = true for ALL items
const shouldUpdateItemTimeStart = true; // line 336: shouldUpdateItemTimeStart = true;

console.log('\n   ⚠️ shouldUpdateItemTimeStart = true');
console.log('   → API sẽ loop qua TẤT CẢ items trong itemSegmentsMap...');

console.log('\n   🐛🐛🐛 BUG: Loop cập nhật timeStart + timeEnd cho TỪNG item:');

for (const [itemId, segs] of itemSegmentsMap.entries()) {
    const itemName = bookingItems.find(i => i.id === itemId).service_name;
    
    if (shouldUpdateItemTimeStart) {
        const payload = {};
        payload.timeStart = sharedTimeStart;
        let totalDur = 0;
        segs.forEach(seg => { totalDur += Number(seg.duration || 0); });
        const endTimeMs = new Date(sharedTimeStart).getTime() + totalDur * 60000;
        payload.timeEnd = new Date(endTimeMs).toISOString();
        
        console.log(`\n     📝 Item "${itemName}" (${itemId}):`);
        console.log(`        timeStart = ${payload.timeStart}`);
        console.log(`        timeEnd   = ${payload.timeEnd}`);
        console.log(`        totalDur  = ${totalDur} phút (CHỈ tính segments CỦA ITEM NÀY)`);
        
        // Simulate what gets saved to DB
        const dbItem = bookingItems.find(i => i.id === itemId);
        dbItem.timeStart = payload.timeStart;
        dbItem.timeEnd = payload.timeEnd;
    }
}

// Step 5: Update ALL items status to IN_PROGRESS (lines 434-440)
console.log('\n   📝 Update ALL items status = IN_PROGRESS');
bookingItems.forEach(item => { item.status = 'IN_PROGRESS'; });

console.log('\n═══════════════════════════════════════════════════════════');
console.log('📊 KẾT QUẢ SAU KHI KTV BẤM START:');
console.log('═══════════════════════════════════════════════════════════');

const formatVN = (isoStr) => {
    if (!isoStr) return 'null';
    const d = new Date(isoStr);
    const vnMs = d.getTime() + 7 * 60 * 60 * 1000;
    const vn = new Date(vnMs);
    return `${String(vn.getUTCHours()).padStart(2,'0')}:${String(vn.getUTCMinutes()).padStart(2,'0')}`;
};

bookingItems.forEach(item => {
    console.log(`\n  📌 ${item.service_name}:`);
    console.log(`     Status:    ${item.status}`);
    console.log(`     BẮT ĐẦU:  ${formatVN(item.timeStart)}`);
    console.log(`     KẾT THÚC: ${formatVN(item.timeEnd)}`);
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🔍 PHÂN TÍCH NGUYÊN NHÂN GỐC RỄ:');
console.log('═══════════════════════════════════════════════════════════');
console.log(`
  ❌ BUG 1: Cả 2 DV đều bị set CÙNG timeStart (${formatVN(sharedTimeStart)})
     → Root cause: Khi shouldUpdateItemTimeStart = true, API loop qua
       itemSegmentsMap và set payload.timeStart = sharedTimeStart cho MỌI item.
     → Đáng lẽ: DV2 phải bắt đầu SAU khi DV1 kết thúc.

  ❌ BUG 2: timeEnd được tính = timeStart + totalDur CỦA ITEM ĐÓ
     → Root cause: Mỗi item tính timeEnd = sharedTimeStart + duration_riêng
     → VD: Item 1 (2p): 10:56 + 2p = 10:58 ✓
            Item 2 (3p): 10:56 + 3p = 10:59 ✗ (đáng lẽ: 10:58 + 3p = 11:01)
     → Nhưng screenshot cho thấy CẢ 2 item đều = 10:59
        ⇒ Có khả năng items dùng chung duration từ services lookup, hoặc
           tính tổng segments sai (nếu segments đều trỏ về cùng 1 ktvId)

  ❌ BUG 3 (Case E): KTV chỉ "Start" cho DV1, nhưng status=IN_PROGRESS 
     được set cho CẢ 2 items (lines 434-440)
     → Đáng lẽ: Chỉ item đầu tiên (DV1) được set IN_PROGRESS.
       DV2 phải giữ status=PREPARING hoặc WAITING cho đến khi DV1 xong.
`);

console.log('═══════════════════════════════════════════════════════════');
console.log('✅ GIẢI PHÁP ĐỀ XUẤT:');
console.log('═══════════════════════════════════════════════════════════');
console.log(`
  1. [API route.ts] Khi 1 KTV có NHIỀU items (Case E), phải phân biệt:
     → Item "hiện tại" (đang active) vs Items "chờ" (queue tiếp theo)
     
  2. Chỉ set timeStart + IN_PROGRESS cho item ĐANG ACTIVE
     → Các items sau giữ status PREPARING/WAITING
     
  3. Khi KTV hoàn tất DV1 (handleFinishTimer → NEXT_SEGMENT):
     → Set DV1.timeEnd = now
     → Set DV2.timeStart = now, DV2.status = IN_PROGRESS
     
  4. Cách xác định "item hiện tại":
     → Sort allGlobalSegs theo startTime
     → activeSegmentIndex = 0 → chặng thuộc item nào = item đang active
     → Các items có chặng ở sau = items chờ
`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🎯 EXPECTED BEHAVIOR (SAU KHI FIX):');
console.log('═══════════════════════════════════════════════════════════');
console.log(`
  KTV NH002 bấm Start:
    Tinh dầu:        BẮT ĐẦU 10:56  →  KẾT THÚC 10:58  (2 phút)
    Chăm sóc da mặt: BẮT ĐẦU chưa   →  KẾT THÚC chưa   (chờ DV1 xong)

  KTV NH002 hoàn tất Tinh dầu (10:58):
    Tinh dầu:        BẮT ĐẦU 10:56  →  KẾT THÚC 10:58  ✓
    Chăm sóc da mặt: BẮT ĐẦU 10:58  →  KẾT THÚC 11:01  (3 phút)
`);
