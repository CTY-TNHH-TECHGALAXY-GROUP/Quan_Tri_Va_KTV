/**
 * ================================================================
 * QA SCRIPT: Shift Extension Proofs (Bắt buộc 2 ảnh khi KTV bắt đầu)
 * ================================================================
 * Kiểm chứng 10 kịch bản theo yêu cầu nghiệp vụ:
 * 1. photoBase64 dài hơn 7.000.000 ký tự bị schema từ chối.
 * 2. Thiếu một trong hai ảnh → HTTP 400.
 * 3. activeSegmentIndex không hợp lệ → HTTP 400.
 * 4. Chặng đã kết thúc → HTTP 409.
 * 5. MIME hoặc magic bytes không khớp → HTTP 400.
 * 6. Upload ảnh thứ hai lỗi → xóa ảnh thứ nhất, không update BookingItems/TurnQueue.
 * 7. Upload đủ hai ảnh nhưng update BookingItems đầu tiên lỗi → xóa cả hai ảnh và trả HTTP 500.
 * 8. Update item thứ hai lỗi sau khi item đầu đã lưu → không xóa ảnh đang được item đầu tham chiếu; trả cảnh báo partial update.
 * 9. Thành công không merge → chỉ target segment nhận startPhotoUrl và guestSlipperPhotoUrl.
 * 10. Segment đã hoàn tất không bị ghi đè ảnh.
 *
 * Chạy:
 *   ./node_modules/.bin/ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_shift_extension_proofs.ts
 */

import assert from 'assert';
import { handleStartTimer } from '@/app/api/ktv/booking/_handlers/handleStartTimer';
import { KtvBookingPatchSchema } from '@/lib/schemas/ktv.schema';

const VALID_JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const VALID_PNG = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');

interface MockOptions {
    bookings?: any[];
    bookingItems?: any[];
    turnQueue?: any;
    uploadFailOnCall?: number; // 1-indexed (1 = slipper fails, 2 = start fails)
    failBookingItemUpdateAtItemIndex?: number; // 0-indexed
}

function createMockSupabase(options: MockOptions = {}) {
    const bookings = options.bookings ? JSON.parse(JSON.stringify(options.bookings)) : [{ id: 'BK-1', timeStart: '2026-09-21T09:00:00Z', status: 'CONFIRMED' }];
    const bookingItems = options.bookingItems ? JSON.parse(JSON.stringify(options.bookingItems)) : [];

    let uploadCallCount = 0;
    const uploadedPaths: string[] = [];
    const removedPaths: string[][] = [];
    let bookingItemUpdateCallCount = 0;
    const bookingItemUpdates: { id: string; payload: any }[] = [];
    const turnQueueUpdates: any[] = [];

    const storage = {
        from: (bucket: string) => ({
            upload: async (fileName: string, buffer: Buffer, opts: any) => {
                uploadCallCount++;
                if (options.uploadFailOnCall === uploadCallCount) {
                    return { data: null, error: new Error(`Mock storage upload failure at call ${uploadCallCount}`) };
                }
                const path = `${bucket}/${fileName}`;
                uploadedPaths.push(path);
                return { data: { path }, error: null };
            },
            getPublicUrl: (path: string) => ({
                data: { publicUrl: `https://mock-storage.local/${path}` }
            }),
            remove: async (paths: string[]) => {
                removedPaths.push([...paths]);
                return { data: null, error: null };
            }
        })
    };

    const from = (tableName: string) => {
        let filters: { col: string; val: any; type: string }[] = [];
        let updatePayload: any = null;

        const chain: any = {
            select: () => chain,
            eq: (col: string, val: any) => {
                filters.push({ col, val, type: 'eq' });
                return chain;
            },
            in: (col: string, val: any) => {
                filters.push({ col, val, type: 'in' });
                return chain;
            },
            single: async () => {
                if (tableName === 'Bookings') {
                    const idFilter = filters.find(f => f.col === 'id');
                    const b = bookings.find((x: any) => x.id === idFilter?.val);
                    return { data: b || null, error: null };
                }
                return { data: null, error: null };
            },
            maybeSingle: async () => {
                if (tableName === 'Bookings') {
                    const idFilter = filters.find(f => f.col === 'id');
                    const b = bookings.find((x: any) => x.id === idFilter?.val);
                    return { data: b || null, error: null };
                }
                return { data: null, error: null };
            },
            update: (payload: any) => {
                updatePayload = payload;
                return chain;
            },
            then: (resolve: any, reject: any) => {
                if (updatePayload) {
                    if (tableName === 'BookingItems') {
                        const callIndex = bookingItemUpdateCallCount++;
                        const idFilter = filters.find(f => f.col === 'id');
                        bookingItemUpdates.push({ id: idFilter?.val, payload: updatePayload });

                        if (options.failBookingItemUpdateAtItemIndex === callIndex) {
                            return Promise.resolve({ data: null, error: new Error(`Mock DB update error at index ${callIndex}`) }).then(resolve, reject);
                        }

                        // Apply to in-memory items
                        const itm = bookingItems.find((x: any) => x.id === idFilter?.val);
                        if (itm && updatePayload.segments) {
                            itm.segments = updatePayload.segments;
                        }
                        return Promise.resolve({ data: itm, error: null }).then(resolve, reject);
                    }
                    if (tableName === 'TurnQueue') {
                        turnQueueUpdates.push(updatePayload);
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    }
                    if (tableName === 'Bookings') {
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    }
                }

                // Default SELECT resolving
                if (tableName === 'BookingItems') {
                    const inFilter = filters.find(f => f.col === 'id' && f.type === 'in');
                    if (inFilter) {
                        const matched = bookingItems.filter((x: any) => inFilter.val.includes(x.id));
                        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
                    }
                    const eqBookingFilter = filters.find(f => f.col === 'bookingId');
                    if (eqBookingFilter) {
                        const matched = bookingItems.filter((x: any) => x.bookingId === eqBookingFilter.val);
                        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
                    }
                    return Promise.resolve({ data: bookingItems, error: null }).then(resolve, reject);
                }

                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
        };

        return chain;
    };

    return {
        supabase: { from, storage } as any,
        bookingItems,
        bookingItemUpdates,
        turnQueueUpdates,
        uploadedPaths,
        removedPaths
    };
}

let passedTests = 0;
let totalTests = 0;

async function runTest(description: string, fn: () => Promise<void>) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✅ Case ${totalTests}: ${description}`);
    } catch (err: any) {
        console.error(`  ❌ Case ${totalTests} FAILED: ${description}`);
        console.error(err);
        process.exitCode = 1;
    }
}

async function main() {
    console.log('\n🚀 Bắt đầu kiểm chứng QA 10 cases bắt buộc:');

    // 1. photoBase64 dài hơn 7.000.000 ký tự bị schema từ chối.
    await runTest('photoBase64 dài hơn 7.000.000 ký tự bị schema từ chối', async () => {
        const oversized = KtvBookingPatchSchema.safeParse({
            bookingId: 'BK-1',
            status: 'IN_PROGRESS',
            action: 'START_TIMER',
            photoBase64: 'a'.repeat(7_000_001)
        });
        assert.strictEqual(oversized.success, false, 'Schema phải từ chối chuỗi > 7_000_000 ký tự');

        const validBoundary = KtvBookingPatchSchema.safeParse({
            bookingId: 'BK-1',
            status: 'IN_PROGRESS',
            action: 'START_TIMER',
            photoBase64: 'a'.repeat(7_000_000)
        });
        assert.strictEqual(validBoundary.success, true, 'Schema phải chấp nhận chuỗi <= 7_000_000 ký tự');
    });

    // 2. Thiếu một trong hai ảnh → HTTP 400.
    await runTest('Thiếu một trong hai ảnh → HTTP 400', async () => {
        const mock = createMockSupabase({
            bookingItems: [{
                id: 'item1',
                bookingId: 'BK-1',
                segments: [{
                    ktvId: 'KTV01',
                    startTime: '10:00'
                }]
            }]
        });
        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: 0,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: null
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 400, 'HTTP status phải là 400');
        const json = await result.earlyResponse.json();
        assert.strictEqual(json.error, 'Bắt buộc có ảnh dép khách và ảnh bắt đầu dịch vụ');
    });

    // 3. activeSegmentIndex không hợp lệ → HTTP 400.
    await runTest('activeSegmentIndex không hợp lệ → HTTP 400', async () => {
        const mock = createMockSupabase();
        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: -1,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 400, 'HTTP status phải là 400');
        const json = await result.earlyResponse.json();
        assert.strictEqual(json.error, 'Chặng làm việc không hợp lệ');
    });

    // 4. Chặng đã kết thúc → HTTP 409.
    await runTest('Chặng đã kết thúc → HTTP 409', async () => {
        const mock = createMockSupabase({
            bookingItems: [{
                id: 'item1',
                bookingId: 'BK-1',
                segments: [{
                    ktvId: 'KTV01',
                    startTime: '10:00',
                    actualStartTime: '10:05',
                    actualEndTime: '10:50' // đã hoàn tất
                }]
            }]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: 0,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 409, 'HTTP status phải là 409');
        const json = await result.earlyResponse.json();
        assert.strictEqual(json.error, 'Không tìm thấy chặng đang xử lý hoặc chặng đã hoàn tất');
    });

    // 5. MIME hoặc magic bytes không khớp → HTTP 400.
    await runTest('MIME hoặc magic bytes không khớp → HTTP 400', async () => {
        const mock = createMockSupabase({
            bookingItems: [{
                id: 'item1',
                bookingId: 'BK-1',
                segments: [{
                    ktvId: 'KTV01',
                    startTime: '10:00'
                }]
            }]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: 0,
                // Header là JPEG nhưng nội dung byte không phải JPEG magic bytes 0xFF 0xD8 0xFF
                guestSlipperPhotoBase64: 'data:image/jpeg;base64,AAAA',
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 400, 'HTTP status phải là 400');
        const json = await result.earlyResponse.json();
        assert.strictEqual(json.error, 'Nội dung ảnh không khớp định dạng');
    });

    // 6. Upload ảnh thứ hai lỗi → xóa ảnh thứ nhất, không update BookingItems/TurnQueue.
    await runTest('Upload ảnh thứ hai lỗi → xóa ảnh thứ nhất, không update BookingItems/TurnQueue', async () => {
        const mock = createMockSupabase({
            uploadFailOnCall: 2, // call 1 (slipper) OK, call 2 (start) fails
            bookingItems: [{
                id: 'item1',
                bookingId: 'BK-1',
                segments: [{
                    ktvId: 'KTV01',
                    startTime: '10:00'
                }]
            }]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: 0,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_PNG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 500, 'HTTP status phải là 500');
        assert.strictEqual(mock.removedPaths.length, 1, 'Phải gọi storage.remove để dọn dẹp ảnh mồ côi');
        assert.strictEqual(mock.removedPaths[0].length, 1, 'Chỉ dọn đúng 1 ảnh đã upload ở bước 1');
        assert.strictEqual(mock.bookingItemUpdates.length, 0, 'Không được gọi update BookingItems');
        assert.strictEqual(mock.turnQueueUpdates.length, 0, 'Không được gọi update TurnQueue');
    });

    // 7. Upload đủ hai ảnh nhưng update BookingItems đầu tiên lỗi → xóa cả hai ảnh và trả HTTP 500.
    await runTest('Upload đủ hai ảnh nhưng update BookingItems đầu tiên lỗi → xóa cả hai ảnh và trả HTTP 500', async () => {
        const mock = createMockSupabase({
            failBookingItemUpdateAtItemIndex: 0, // item 0 update fails
            bookingItems: [{
                id: 'item1',
                bookingId: 'BK-1',
                segments: [{
                    ktvId: 'KTV01',
                    startTime: '10:00'
                }]
            }]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1'],
            body: {
                activeSegmentIndex: 0,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 500, 'HTTP status phải là 500');
        assert.strictEqual(mock.removedPaths.length, 1, 'Phải gọi remove dọn dẹp');
        assert.strictEqual(mock.removedPaths[0].length, 2, 'Phải xóa cả 2 ảnh đã upload');
    });

    // 8. Update item thứ hai lỗi sau khi item đầu đã lưu → không xóa ảnh đang được item đầu tham chiếu; trả cảnh báo partial update.
    await runTest('Update item thứ hai lỗi sau khi item đầu đã lưu → không xóa ảnh; trả cảnh báo partial update', async () => {
        const mock = createMockSupabase({
            failBookingItemUpdateAtItemIndex: 1, // item 0 update OK, item 1 fails
            bookingItems: [
                {
                    id: 'item1',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '10:00'
                    }]
                },
                {
                    id: 'item2',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '11:00'
                    }]
                }
            ]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1', 'item2'],
            body: {
                activeSegmentIndex: 0,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.ok(result.earlyResponse, 'Phải trả earlyResponse');
        assert.strictEqual(result.earlyResponse.status, 500, 'HTTP status phải là 500');
        assert.strictEqual(mock.removedPaths.length, 0, 'KHÔNG được xóa ảnh vì item 1 đã lưu tham chiếu');
        const json = await result.earlyResponse.json();
        assert.ok(json.error.includes('Lưu ý: Đã cập nhật dở 1/2 item'), `Phải có thông báo cập nhật dở: ${json.error}`);
    });

    // 9. Thành công không merge → chỉ target segment nhận startPhotoUrl và guestSlipperPhotoUrl.
    await runTest('Thành công không merge → chỉ target segment nhận startPhotoUrl và guestSlipperPhotoUrl', async () => {
        const mock = createMockSupabase({
            bookingItems: [
                {
                    id: 'item1',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '10:00'
                    }]
                },
                {
                    id: 'item2',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '11:00'
                    }]
                }
            ]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1', 'item2'],
            body: {
                activeSegmentIndex: 0,
                shouldMerge: false,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.strictEqual(result.earlyResponse, undefined, 'Thành công không được có earlyResponse');

        const item1Saved = mock.bookingItems.find((i: any) => i.id === 'item1');
        const item2Saved = mock.bookingItems.find((i: any) => i.id === 'item2');

        const seg0 = typeof item1Saved.segments === 'string' ? JSON.parse(item1Saved.segments)[0] : item1Saved.segments[0];
        const seg1 = typeof item2Saved.segments === 'string' ? JSON.parse(item2Saved.segments)[0] : item2Saved.segments[0];

        assert.ok(seg0.startPhotoUrl, 'Target segment 0 phải có startPhotoUrl');
        assert.ok(seg0.guestSlipperPhotoUrl, 'Target segment 0 phải có guestSlipperPhotoUrl');
        assert.strictEqual(seg1.startPhotoUrl, undefined, 'Segment 1 không được nhận startPhotoUrl khi không merge');
        assert.strictEqual(seg1.guestSlipperPhotoUrl, undefined, 'Segment 1 không được nhận guestSlipperPhotoUrl khi không merge');
    });

    // 10. Segment đã hoàn tất không bị ghi đè ảnh.
    await runTest('Segment đã hoàn tất không bị ghi đè ảnh', async () => {
        const OLD_START_URL = 'https://mock-storage.local/attendance/old_start.jpg';
        const OLD_SLIPPER_URL = 'https://mock-storage.local/attendance/old_slipper.jpg';

        const mock = createMockSupabase({
            bookingItems: [
                {
                    id: 'item1',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '10:00',
                        actualStartTime: '10:05',
                        actualEndTime: '10:50',
                        startPhotoUrl: OLD_START_URL,
                        guestSlipperPhotoUrl: OLD_SLIPPER_URL
                    }]
                },
                {
                    id: 'item2',
                    bookingId: 'BK-1',
                    segments: [{
                        ktvId: 'KTV01',
                        startTime: '11:00'
                    }]
                }
            ]
        });

        const ctx: any = {
            supabase: mock.supabase,
            bookingId: 'BK-1',
            technicianCode: 'KTV01',
            action: 'START_TIMER',
            allItemIdsForThisKTV: ['item1', 'item2'],
            body: {
                activeSegmentIndex: 1, // Bắt đầu segment thứ 2
                shouldMerge: false,
                guestSlipperPhotoBase64: VALID_JPEG,
                startPhotoBase64: VALID_JPEG
            }
        };

        const result = await handleStartTimer(ctx);
        assert.strictEqual(result.earlyResponse, undefined, 'Thành công không được có earlyResponse');

        const item1Saved = mock.bookingItems.find((i: any) => i.id === 'item1');
        const item2Saved = mock.bookingItems.find((i: any) => i.id === 'item2');

        const seg0 = typeof item1Saved.segments === 'string' ? JSON.parse(item1Saved.segments)[0] : item1Saved.segments[0];
        const seg1 = typeof item2Saved.segments === 'string' ? JSON.parse(item2Saved.segments)[0] : item2Saved.segments[0];

        assert.strictEqual(seg0.startPhotoUrl, OLD_START_URL, 'Segment 0 đã kết thúc phải giữ nguyên startPhotoUrl cũ');
        assert.strictEqual(seg0.guestSlipperPhotoUrl, OLD_SLIPPER_URL, 'Segment 0 đã kết thúc phải giữ nguyên guestSlipperPhotoUrl cũ');
        assert.ok(seg1.startPhotoUrl && seg1.startPhotoUrl !== OLD_START_URL, 'Segment 1 phải có startPhotoUrl mới');
        assert.ok(seg1.guestSlipperPhotoUrl && seg1.guestSlipperPhotoUrl !== OLD_SLIPPER_URL, 'Segment 1 phải có guestSlipperPhotoUrl mới');
    });

    console.log(`\n🎉 KẾT QUẢ: ${passedTests}/${totalTests} tests passed!\n`);
    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error running QA script:', err);
    process.exit(1);
});
