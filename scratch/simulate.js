// --- MOCK SERVICES ---
class BookingItemPauseService {
    static swapKtvOnPausedItem(item, oldKtvId, newKtvId, extraTimeMins) {
        let originalDuration = item.Services?.duration || 60;
        let segments = JSON.parse(JSON.stringify(item.segments || []));
        
        // Find assigned duration from A's segment
        const aIndex = segments.findLastIndex((s) => s.ktvId === oldKtvId && !s.endTime);
        if (aIndex !== -1 && segments[aIndex].duration) {
            originalDuration = Number(segments[aIndex].duration);
        }
        
        // Calculate Times
        const originalTimeStartMs = new Date(item.Bookings.timeStart).getTime();
        const pauseStartMs = new Date(item.pauseStart).getTime();
        
        // Mock time A worked
        const timeAWorkedMs = pauseStartMs - originalTimeStartMs;
        const timeAWorkedMins = Math.floor(timeAWorkedMs / 60000);
        
        const remainingMins = Math.max(0, originalDuration - timeAWorkedMins);
        const timeBToWorkMins = remainingMins + extraTimeMins;
        
        // MỚI NHẤT: Quản lý quyết định KHÔNG BAO GIỜ bù lố giờ. 
        // KTV B luôn luôn được hưởng đúng bằng thời gian tua gốc (originalDuration)
        let customCommissionDuration = originalDuration;

        // Close A's segment
        if (aIndex !== -1) {
            segments[aIndex].endTime = item.pauseStart;
            segments[aIndex].note = 'Bị đổi người (Phạt)';
        }

        // Add B's segment
        segments.push({
            ktvId: newKtvId,
            startTime: new Date().toISOString(),
            endTime: null, // B hasn't finished yet in this simulation
            customCommissionDuration: customCommissionDuration,
            note: 'Vào cứu bồ'
        });

        // Simulate TurnLedger is_punished for A
        const turnLedgerA = { employee_id: oldKtvId, is_punished: true };
        const turnLedgerB = { employee_id: newKtvId, is_punished: false };

        return {
            timeAWorkedMins,
            remainingMins,
            extraTimeMins,
            timeBToWorkMins,
            customCommissionDuration,
            newSegments: segments,
            turnLedgerA,
            turnLedgerB
        };
    }
}

class KtvCommissionService {
    static calculateItemDuration(segs, techCode, fallbackDuration) {
        const mySegs = segs.filter((seg) => seg.ktvId === techCode);
        if (mySegs.length > 0) {
            return mySegs.reduce((sum, seg) => {
                if (seg.customCommissionDuration) return sum + Number(seg.customCommissionDuration);
                
                // Mock calculation if no customCommissionDuration
                return sum + (Number(seg.duration) || fallbackDuration);
            }, 0);
        }
        return fallbackDuration;
    }
}

// --- TEST RUNNER ---
function runTest(testName, item, oldKtvId, newKtvId, extraTimeMins) {
    console.log('\n=============================================');
    console.log('🧪 TEST CASE:', testName);
    console.log('📋 Đầu vào:');
    console.log('- DV Gốc:', item.Services.duration, 'phút');
    console.log('- Phân công KTV A (oldKtvId):', item.segments[0].duration ? item.segments[0].duration + ' phút (Split)' : 'Trọn tua');
    console.log('- Bù thêm giờ cho KTV B:', extraTimeMins, 'phút');
    
    // Thực thi Swap
    const result = BookingItemPauseService.swapKtvOnPausedItem(item, oldKtvId, newKtvId, extraTimeMins);
    
    console.log('\n⚙️  Xử lý tính toán nội bộ:');
    console.log('- KTV A đã làm:', result.timeAWorkedMins, 'phút.');
    console.log('- Thời gian còn lại:', result.remainingMins, 'phút.');
    console.log('- KTV B phải làm (Còn lại + Bù):', result.timeBToWorkMins, 'phút.');
    console.log('- Biến customCommissionDuration của B:', result.customCommissionDuration);
    
    console.log('\n💰 KẾT QUẢ TÍNH LƯƠNG TRÊN HỆ THỐNG:');
    
    // KTV A
    const aPunished = result.turnLedgerA.is_punished;
    console.log('[KTV A -', oldKtvId, ']: Bị phạt is_punished =', aPunished, '=> Lương = 0 VNĐ (Vẫn mất 1 tua)');
    
    // KTV B
    const bDurationForWallet = KtvCommissionService.calculateItemDuration(result.newSegments, newKtvId, item.Services.duration);
    console.log('[KTV B -', newKtvId, ']: Hệ thống Wallet ghi nhận làm', bDurationForWallet, 'phút => Nhận lương của', bDurationForWallet, 'phút.');
    console.log('=============================================');
}

// --- SETUP MOCK DATA ---
const now = Date.now();
const thirtyMinsAgo = new Date(now - 30 * 60000).toISOString();
const fifteenMinsAgo = new Date(now - 15 * 60000).toISOString();
const currentTime = new Date(now).toISOString();

// CASE 1: Tiêu chuẩn - 60p, A làm 30p bị đổi, B làm nốt 30p (Không bù giờ)
const case1Item = {
    Bookings: { timeStart: thirtyMinsAgo },
    pauseStart: currentTime,
    Services: { duration: 60 },
    segments: [{ ktvId: 'KTV_A', startTime: thirtyMinsAgo }]
};
runTest('1. Tiêu chuẩn (60p) - Đổi người không bù giờ', case1Item, 'KTV_A', 'KTV_B', 0);

// CASE 2: Ngoại lệ (Cách 2) - 60p, A làm 30p bị đổi, Lễ tân bù thêm 40p cho B
const case2Item = {
    Bookings: { timeStart: thirtyMinsAgo },
    pauseStart: currentTime,
    Services: { duration: 60 },
    segments: [{ ktvId: 'KTV_A', startTime: thirtyMinsAgo }]
};
runTest('2. Bù giờ lố (60p) - Lễ tân bắt B làm thêm 40p', case2Item, 'KTV_A', 'KTV_B', 40);

// CASE 3: Edge Case Chia tua - DV 90p, A được gán 45p, B được gán 45p. A làm 15p thì bị đổi.
const case3Item = {
    Bookings: { timeStart: fifteenMinsAgo },
    pauseStart: currentTime,
    Services: { duration: 90 },
    segments: [
        { ktvId: 'KTV_A', startTime: fifteenMinsAgo, duration: 45 },
        { ktvId: 'KTV_X', startTime: fifteenMinsAgo, duration: 45 } // Người khác làm chung ko liên quan
    ]
};
runTest('3. DV Chia Tua (90p chia đôi) - A chỉ làm phần 45p của mình', case3Item, 'KTV_A', 'KTV_B', 0);

// CASE 4: Edge Case Chia tua bù giờ - A được gán 45p, làm 15p, Lễ tân bù thêm 30p cho B (Cứu bồ ca khó)
const case4Item = {
    Bookings: { timeStart: fifteenMinsAgo },
    pauseStart: currentTime,
    Services: { duration: 90 },
    segments: [
        { ktvId: 'KTV_A', startTime: fifteenMinsAgo, duration: 45 }
    ]
};
runTest('4. DV Chia Tua - Bù giờ cứu bồ cho phần 45p của A', case4Item, 'KTV_A', 'KTV_B', 30);
