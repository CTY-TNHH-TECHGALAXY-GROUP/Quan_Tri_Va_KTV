/**
 * Thoát khỏi một kịch bản QA sao cho MÃ THOÁT tới được nơi cần tới.
 *
 * ⚠️ Đừng gọi `process.exit()` trong mấy kịch bản này. Client Supabase giữ
 * socket keep-alive; gọi `process.exit()` giữa lúc libuv đang đóng handle thì
 * Node trên Windows abort:
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
 *
 * Kịch bản vẫn in đủ "=== DAT ===" rồi mới chết, nên nhìn màn hình tưởng đạt —
 * nhưng mã thoát thành 127. Chuỗi `A && B && C` trong `npm run test:qa` vì thế
 * đứt ngang sau kịch bản đầu tiên dính, mấy kịch bản sau KHÔNG HỀ CHẠY mà cũng
 * không báo gì. Đúng kiểu hỏng nguy hiểm nhất: bộ kiểm thử im lặng bỏ sót việc.
 *
 * Cách đúng: đặt `process.exitCode` rồi để Node tự thoát khi hết việc. Socket
 * keep-alive tự hết hạn. `unref()` cái hẹn giờ chốt chặn để nó không giữ tiến
 * trình sống, nhưng nếu có gì treo thật thì vẫn thoát sau ngần đó giây.
 */
export function finish(failures: number, hardStopSeconds = 20): void {
    process.exitCode = failures === 0 ? 0 : 1;

    const bail = setTimeout(() => {
        console.error(`\n[QA] Con handle treo sau ${hardStopSeconds}s — thoat cuong buc.`);
        process.exit(process.exitCode ?? 1);
    }, hardStopSeconds * 1000);
    bail.unref();
}

/** Kịch bản ném lỗi: in ra rồi đánh dấu hỏng, không giết tiến trình giữa chừng. */
export function fatal(e: unknown): void {
    console.error(e);
    process.exitCode = 1;
}
