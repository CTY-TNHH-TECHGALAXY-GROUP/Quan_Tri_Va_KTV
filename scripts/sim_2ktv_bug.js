// === MÔ PHỎNG: Timer drift khi tắt màn hình ===

console.log('=============================================');
console.log('BUG: Timer sai khi KTV tắt/mở màn hình');
console.log('=============================================\n');

// Giả lập: KTV bắt đầu lúc 10:00, dịch vụ 60 phút
const actualStartTime = new Date('2026-05-16T03:00:00Z'); // 10:00 VN
const duration = 60; // phút

console.log('=== CASE 1: Bình thường (không tắt màn hình) ===');
// Sau 30 phút (10:30)
let now1 = new Date('2026-05-16T03:30:00Z');
let elapsed1 = Math.floor((now1.getTime() - actualStartTime.getTime()) / 1000);
let remaining1 = Math.max(0, duration * 60 - elapsed1);
console.log(`10:30 → elapsed: ${elapsed1}s, remaining: ${remaining1}s (${remaining1/60}p) ✅`);

console.log('\n=== CASE 2: setInterval bị pause khi tắt màn hình ===');
// Vấn đề ở dòng 973-976 (countdown timer):
// setInterval(() => setTimeRemaining(prev => prev - 1), 1000)
// 
// Timeline:
// 10:00 - KTV bấm BẮT ĐẦU, timeRemaining = 3600s
// 10:15 - KTV tắt màn hình (15p đã đếm = 900 tick, remaining = 2700)
// 10:45 - KTV mở lại (30p trôi qua nhưng interval bị PAUSE!)

let timerStart = 3600; // 60 phút
let ticksBeforeSleep = 15 * 60; // 15 phút ticks thực tế
let remainingAfterTicks = timerStart - ticksBeforeSleep; // 3600 - 900 = 2700
console.log(`10:15: Tắt màn hình. Timer đã tick ${ticksBeforeSleep} lần → remaining = ${remainingAfterTicks}s (${remainingAfterTicks/60}p)`);

// Khi mở lại lúc 10:45, setInterval resume nhưng KHÔNG bù thời gian
// Timer vẫn ở 2700s (45 phút) thay vì 900s (15 phút)
console.log(`10:45: Mở lại. Timer HIỂN THỊ: ${remainingAfterTicks}s (${remainingAfterTicks/60}p) ← SAI!`);
console.log(`10:45: Thực tế ĐÚNG: ${duration*60 - 45*60}s (${duration - 45}p)`);
console.log(`=> LỆCH: ${remainingAfterTicks - (duration*60 - 45*60)}s (${(remainingAfterTicks - (duration*60 - 45*60))/60}p)!`);

console.log('\n=== visibilitychange handler hiện tại (dòng 1076-1079) ===');
// Kiểm tra: recalcTimerFromServer có chạy đúng không?
console.log('Code hiện tại:');
console.log('  if (document.visibilityState === "visible") recalcTimerFromServer()');
console.log('');

// recalcTimerFromServer (dòng 983-1071) tính lại dựa trên actualStartTime từ server
let now2 = new Date('2026-05-16T03:45:00Z'); // 10:45 VN
let elapsed2 = Math.floor((now2.getTime() - actualStartTime.getTime()) / 1000);
let correctRemaining = Math.max(0, duration * 60 - elapsed2);
console.log(`recalcTimerFromServer result: ${correctRemaining}s (${correctRemaining/60}p) ← ĐÚNG!`);

console.log('\n=== VẬY VẤN ĐỀ Ở ĐÂU? ===');
console.log('1. visibilitychange + recalcTimerFromServer logic ĐÚNG');
console.log('2. NHƯNG recalcTimerFromServer có guard: if (!isTimerRunningRef.current) return;');
console.log('3. Kiểm tra: isTimerRunningRef.current luôn đúng khi timer đang chạy? → CÓ');
console.log('');
console.log('4. ⚠️ VẤN ĐỀ THẬT SỰ:');
console.log('   - visibilitychange KHÔNG FIRE trên một số mobile browsers khi lock screen!');
console.log('   - iOS Safari: visibilitychange fire khi swipe home, KHÔNG fire khi lock button');  
console.log('   - Android Chrome: visibilitychange CÓ fire khi lock, nhưng KHÔNG fire khi app bị kill');
console.log('');
console.log('5. ⚠️ VẤN ĐỀ THỨ 2: setInterval timer (dòng 973-976) chạy ĐỘC LẬP');
console.log('   với recalcTimerFromServer (dòng 982). Khi mở lại:');
console.log('   - visibilitychange fire → recalcTimerFromServer set đúng = 900s');
console.log('   - NHƯNG setInterval CŨNG đang chạy → lập tức ghi đè = 2699s!');
console.log('   - Race condition: recalc vs setInterval tick');

console.log('\n=== ROOT CAUSE ===');
console.log('Timer dòng 973-976 dùng setInterval đếm "prev - 1" — KHÔNG tham chiếu server time');
console.log('Khi mở lại, recalcTimerFromServer sửa đúng NHƯNG tick tiếp theo ghi đè lại!');
console.log('Hoặc trên iOS, visibilitychange không fire → timer giữ giá trị cũ!');

console.log('\n=== FIX ĐỀ XUẤT ===');
console.log('Thay setInterval(prev - 1) bằng tính toán absolute từ actualStartTime mỗi giây:');
console.log('  setInterval(() => {');
console.log('    const now = Date.now() + timeOffset;');
console.log('    const elapsed = (now - startTimeMs) / 1000;');  
console.log('    setTimeRemaining(Math.max(0, totalSecs - elapsed));');
console.log('  }, 1000);');
console.log('→ Mỗi tick đều tính từ server time, không phụ thuộc vào tick trước!');
