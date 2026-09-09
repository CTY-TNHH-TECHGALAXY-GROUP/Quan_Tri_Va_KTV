import { SupabaseClient } from '@supabase/supabase-js';
import { closeOpenPause, voidSegment } from '@/lib/segment-time';
import { ktvMatchesSeg } from '@/lib/ktvUtils';
import { punishTurnIfIdle, ledgerBookingIdOf } from '@/lib/turn-punish';
import { logCounterAction, currentCounterActor } from '@/lib/counter-action-log';

export class BookingItemPauseService {
    /**
     * Tạm ngưng dịch vụ (Pause)
     */
    static async pauseItem(supabase: SupabaseClient, bookingItemId: string) {
        const now = new Date().toISOString();
        
        // 1. Lấy thông tin BookingItem để biết bookingId, KTV, và segments
        const { data: item } = await supabase
            .from('BookingItems')
            .select('id, bookingId, "technicianCodes", segments')
            .eq('id', bookingItemId)
            .single();

        if (!item) throw new Error('Không tìm thấy dịch vụ.');

        let itemIdsToPause = [bookingItemId];

        // Tìm các KTV đang thực sự chạy (actualStartTime có, actualEndTime null)
        let activeKtvIds: string[] = [];
        let segments = item.segments;
        if (typeof segments === 'string') {
            try { segments = JSON.parse(segments); } catch { segments = []; }
        }
        if (Array.isArray(segments)) {
            activeKtvIds = segments
                .filter((seg: any) => seg.actualStartTime && !seg.actualEndTime && seg.ktvId)
                .map((seg: any) => seg.ktvId);
        }
        if (activeKtvIds.length === 0 && Array.isArray(item.technicianCodes)) {
            activeKtvIds = item.technicianCodes;
        }

        // Tìm tất cả các item đang IN_PROGRESS của các KTV đang chạy trong cùng booking để pause chung (Merged services)
        if (activeKtvIds.length > 0) {
            const { data: siblingItems } = await supabase
                .from('BookingItems')
                .select('id, "technicianCodes"')
                .eq('bookingId', item.bookingId)
                .eq('status', 'IN_PROGRESS');
                
            if (siblingItems) {
                const siblingIds = siblingItems
                    .filter((s: any) => Array.isArray(s.technicianCodes) && s.technicianCodes.some((k: string) => activeKtvIds.includes(k)))
                    .map((s: any) => s.id);
                if (siblingIds.length > 0) {
                    itemIdsToPause = Array.from(new Set([...itemIdsToPause, ...siblingIds]));
                }
            }
        }
        
        // Cập nhật trạng thái và lưu thời gian pause
        const { error } = await supabase
            .from('BookingItems')
            .update({
                status: 'PAUSED',
                pauseStart: now
            })
            .in('id', itemIdsToPause);

        if (error) {
            console.error('Error pausing items:', error);
            throw new Error('Không thể tạm ngưng dịch vụ.');
        }

        // Mở một khoảng dừng trên mọi chặng còn đang chạy.
        // resumeItem sẽ đóng lại bằng `to`. Nhờ vậy giờ làm thực trừ được đúng
        // phần ngồi chờ mà KHÔNG phải dời `actualStartTime` (xem lib/segment-time.ts).
        await BookingItemPauseService.openPauseWindows(supabase, itemIdsToPause, now);

        const actorPause = await currentCounterActor();
        await logCounterAction(supabase, itemIdsToPause, {
            action: 'PAUSE', by: actorPause.id, byName: actorPause.name, at: now,
        });

        return { success: true, pauseStart: now, pausedItemIds: itemIdsToPause };
    }

    /** Ghi `pauses[].from` vào các chặng đang chạy của những item vừa tạm dừng. */
    private static async openPauseWindows(supabase: SupabaseClient, itemIds: string[], at: string) {
        const { data: rows } = await supabase
            .from('BookingItems')
            .select('id, segments')
            .in('id', itemIds);

        for (const row of rows || []) {
            const isString = typeof row.segments === 'string';
            let segs: any = row.segments;
            if (isString) { try { segs = JSON.parse(segs); } catch { segs = []; } }
            if (!Array.isArray(segs)) continue;

            let touched = false;
            const updated = segs.map((seg: any) => {
                if (!seg.actualStartTime || seg.actualEndTime) return seg;
                const pauses = Array.isArray(seg.pauses) ? [...seg.pauses] : [];
                // Đã có khoảng còn hở thì thôi, đừng mở chồng lên nhau.
                if (pauses.some((p: any) => p && p.from && !p.to)) return seg;
                pauses.push({ from: at });
                touched = true;
                return { ...seg, pauses };
            });

            if (!touched) continue;
            await supabase
                .from('BookingItems')
                .update({ segments: isString ? JSON.stringify(updated) : updated })
                .eq('id', row.id);
        }
    }

    /**
     * Khôi phục dịch vụ sau khi Pause (Resume)
     * Hàm này tính toán khoảng thời gian đã bị Pause và cộng bù vào timeStart của Booking,
     * để timer trên màn hình KTV tiếp tục chạy mượt mà không bị hụt giờ.
     */
    static async resumeItem(supabase: SupabaseClient, bookingItemId: string) {
        // 1. Lấy thông tin BookingItem và Booking
        const { data: item, error: errItem } = await supabase
            .from('BookingItems')
            .select('id, pauseStart, bookingId, segments, "technicianCodes"')
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) {
            throw new Error('Không tìm thấy dịch vụ.');
        }

        let itemIdsToResume = [bookingItemId];

        if (!item.pauseStart) {
            // Nếu không có pauseStart, chỉ đổi status
            await supabase.from('BookingItems').update({ status: 'IN_PROGRESS' }).eq('id', bookingItemId);
            return { success: true };
        }

        // ⚠️ Trước đây chỗ này phải đọc `Bookings.timeStart` để tịnh tiến nó, và
        // nếu thiếu thì thoát sớm — nhánh thoát đó nay CỰC nguy hiểm: nó bỏ qua
        // việc đóng khoảng dừng, khiến khoảng hở kéo dài tới tận lúc kết thúc và
        // ăn mất phần làm thật của KTV. Không còn dời timeStart nữa nên bỏ luôn
        // cả truy vấn lẫn nhánh thoát; mọi đường đều phải đóng khoảng dừng.

        // 2. Mốc tiếp tục — dùng để đóng khoảng dừng trên từng chặng.
        const nowMs = Date.now();
        const resumeAt = new Date(nowMs).toISOString();

        // Tìm các KTV đang thực sự bị Pause
        let activeKtvIds: string[] = [];
        let segments = item.segments;
        if (typeof segments === 'string') {
            try { segments = JSON.parse(segments); } catch { segments = []; }
        }
        if (Array.isArray(segments)) {
            activeKtvIds = segments
                .filter((seg: any) => seg.actualStartTime && !seg.actualEndTime && seg.ktvId)
                .map((seg: any) => seg.ktvId);
        }
        if (activeKtvIds.length === 0 && Array.isArray(item.technicianCodes)) {
            activeKtvIds = item.technicianCodes;
        }

        // 3. Tìm tất cả các items đang PAUSED của các KTV này trong cùng booking (Merged services)
        let itemsToUpdate = [item];
        if (activeKtvIds.length > 0) {
            const { data: siblingItems } = await supabase
                .from('BookingItems')
                .select('id, bookingId, pauseStart, segments, "technicianCodes"')
                .eq('bookingId', item.bookingId)
                .eq('status', 'PAUSED');
                
            if (siblingItems) {
                const siblings = siblingItems.filter((s: any) => 
                    s.id !== bookingItemId && 
                    Array.isArray(s.technicianCodes) && 
                    s.technicianCodes.some((k: string) => activeKtvIds.includes(k))
                );
                itemsToUpdate = [...itemsToUpdate, ...siblings];
            }
        }

        // 4. Tịnh tiến thời gian của các chặng (segments) đang mở cho TẤT CẢ các items liên quan
        for (const updateItem of itemsToUpdate) {
            let updatedSegments = updateItem.segments;
            let isString = typeof updatedSegments === 'string';
            if (isString) {
                try {
                    updatedSegments = JSON.parse(updatedSegments);
                } catch {
                    updatedSegments = [];
                }
            }

            if (Array.isArray(updatedSegments)) {
                updatedSegments = updatedSegments.map((seg: any) => {
                    if (!seg.actualStartTime || seg.actualEndTime) return seg;

                    // ⚠️ TUYỆT ĐỐI KHÔNG dời `actualStartTime` nữa.
                    // Cách cũ cộng thời gian dừng vào mốc bắt đầu → ô "Bắt đầu" trên
                    // Kanban nhảy muộn sau mỗi lần tạm dừng và mất mốc thật vĩnh viễn.
                    // Nay chỉ đóng khoảng dừng lại; giờ làm thực do lib/segment-time.ts trừ ra.
                    const next = { ...seg, pauses: Array.isArray(seg.pauses) ? [...seg.pauses] : [] };
                    if (!closeOpenPause(next, resumeAt, 'RESUME')) {
                        // Chặng bị dừng bằng code cũ (chưa có `pauses`) — dựng lại
                        // khoảng dừng từ `pauseStart` để không mất phần đã chờ.
                        next.pauses.push({ from: item.pauseStart, to: resumeAt, closedBy: 'RESUME' });
                    }
                    return next;
                });
            }
            
            if (isString) {
                updatedSegments = JSON.stringify(updatedSegments) as any;
            }

            await supabase
                .from('BookingItems')
                .update({ 
                    status: 'IN_PROGRESS',
                    pauseStart: null,
                    segments: updatedSegments
                })
                .eq('id', updateItem.id);
        }

        // ⚠️ KHÔNG dời `Bookings.timeStart` nữa — cùng lý do với `actualStartTime`:
        // đó là mốc đơn bắt đầu thật, dời đi là mất. Phần bù thời gian tạm dừng
        // nay nằm ở `seg.pauses[]` và được trừ lúc tính (lib/segment-time.ts).

        const actorResume = await currentCounterActor();
        await logCounterAction(supabase, itemsToUpdate.map(i => i.id), {
            action: 'RESUME', by: actorResume.id, byName: actorResume.name, at: resumeAt,
        });

        return { success: true, resumedAt: resumeAt, resumedItemIds: itemsToUpdate.map(i => i.id) };
    }

    /**
     * Đổi KTV B cho một dịch vụ đang bị Tạm ngưng, và phạt KTV A
     */
    static async swapKtvOnPausedItem(
        supabase: SupabaseClient, 
        bookingItemId: string, 
        oldKtvId: string, 
        newKtvId?: string, 
        extraTimeMins: number = 0,
        businessDate?: string,
        keepTurnForOldKtv: boolean = false,
        /**
         * Số phút quầy gán tay cho KTV mới. Bỏ trống (0) thì dùng công thức cũ:
         * phần còn lại của dịch vụ + giờ bù. Luôn bị kẹp trần bằng thời lượng
         * dịch vụ, không cho vượt (chốt 06/09/2026).
         */
        assignedMins: number = 0
    ) {
        // 1. Fetch Item & Booking & Service
        const { data: item, error: errItem } = await supabase
            .from('BookingItems')
            .select(`
                id, 
                bookingId, 
                technicianCodes, 
                segments, 
                pauseStart,
                serviceId,
                status,
                Bookings!fk_bookingitems_booking ( id, timeStart ),
                Services ( duration )
            `)
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) throw new Error('Không tìm thấy dịch vụ.');
        if (!item.pauseStart && item.status !== 'PAUSED') {
             throw new Error('Dịch vụ chưa được Tạm ngưng. Vui lòng Tạm ngưng trước khi rút/đổi KTV.');
        }

        const booking = (item.Bookings as any);
        let originalDuration = (item.Services as any)?.duration || 60;
        
        if (extraTimeMins > originalDuration) {
            throw new Error(`Thời gian bù thêm không được vượt quá thời gian của dịch vụ (${originalDuration} phút).`);
        }

        // Loại hình quyết định KTV "mất/được" cái gì khi đổi người:
        //   A/B/C → chạy theo SỔ TUA        (turns_completed ASC, app/api/turns/route.ts)
        //   D     → chạy theo GIỜ TÍCH LUỸ  (net_hours DESC, đọc KTVDTurnLedger)
        // `TurnLedger` KHÔNG đụng tới thứ tự của D, nên cộng/tước tua cho D vừa vô
        // nghĩa vừa đẻ ra tua ma trong báo cáo tài chính (nơi vẫn đếm TurnLedger).
        // Với D, chặng `voided` ở dưới mới là thứ tước giờ — và nó tự động.
        const dsLoai = [oldKtvId, newKtvId].filter(Boolean) as string[];
        const { data: staffTypes } = await supabase
            .from('Staff')
            .select('id, work_type')
            .in('id', dsLoai);
        const theoSoTua = (id: string) =>
            ((staffTypes || []).find((s: any) => s.id === id)?.work_type || 'TYPE_A') !== 'TYPE_D';

        // Hạ KTV cũ xuống waiting — CHỈ khi hàng đợi của họ đang trỏ vào ĐƠN NÀY.
        // ⚠️ Trước 09/09/2026 lệnh này chỉ lọc theo (employee_id, date). KTV cũ vừa
        // bị rút khỏi đơn này mà đã được gán sang đơn khác thì bị gỡ luôn khỏi đơn
        // kia — mất phòng, mất giường, đơn kia thành đơn không người làm.
        if (businessDate) {
            const { data: hangCu } = await supabase
                .from('TurnQueue')
                .select('id, current_order_id, booking_item_id, booking_item_ids, queue_position')
                .eq('employee_id', oldKtvId)
                .eq('date', businessDate)
                .maybeSingle();

            const q = hangCu as any;
            const dangOmDonNay = !!q && (
                q.current_order_id === item.bookingId
                || q.booking_item_id === bookingItemId
                || (Array.isArray(q.booking_item_ids) && q.booking_item_ids.includes(bookingItemId))
            );

            if (dangOmDonNay) {
                await supabase
                    .from('TurnQueue')
                    .update({ status: 'waiting', current_order_id: null, booking_item_id: null, booking_item_ids: [] })
                    .eq('id', q.id);
            }

            // Đóng phiếu phân công của KTV cũ trên chính dịch vụ này.
            // ⚠️ Bỏ bước này là KTV cũ giữ mãi một dòng ACTIVE cho đơn họ không còn
            // làm. `promote_next_assignment` gặp dòng đó là thoát ngay với "KTV
            // already has an ACTIVE assignment" — họ không bao giờ được kéo đơn kế
            // tiếp lên nữa. Đây đúng là kiểu "KTV kẹt đơn".
            const { error: errHuyPhieu } = await supabase
                .from('KtvAssignments')
                .update({ status: 'CANCELLED' })
                .eq('employee_id', oldKtvId)
                .eq('business_date', businessDate)
                .eq('booking_item_id', bookingItemId);
            if (errHuyPhieu) {
                console.error('[swapKtv] khong dong duoc phieu phan cong cu:', errHuyPhieu.message);
            }

            // Kéo đơn kế tiếp của KTV cũ lên, giống luồng huỷ điều phối
            // (dispatch_confirm_booking cũng PERFORM promote_next_assignment cho
            // KTV bị gỡ). Không gọi thì họ ngồi không cho tới khi có sự kiện khác
            // đánh thức, dù trong hàng vẫn còn đơn đã xếp sẵn cho họ.
            //
            // ⚠️ PHẢI chạy SAU khi phiếu ở trên đã CANCELLED: RPC gặp một dòng
            // ACTIVE là thoát ngay với "KTV already has an ACTIVE assignment".
            //
            // ⚠️ Khi họ KHÔNG còn đơn nào, RPC đặt lại queue_position = max + 1,
            // tức đẩy xuống cuối bảng — phá đúng thứ tự mà quầy vừa kéo tay.
            // Thứ tự nhận khách không đọc cột này (A/B/C theo turns_completed,
            // D theo net_hours) nhưng bảng tua thì có, nên chụp lại rồi trả về
            // chỗ cũ khi không kéo được đơn nào lên.
            if (dangOmDonNay) {
                const viTriCu = q.queue_position;
                const { data: kqPromote, error: errPromote } = await supabase.rpc('promote_next_assignment', {
                    p_employee_id: oldKtvId,
                    p_business_date: businessDate,
                });
                if (errPromote) {
                    console.error('[swapKtv] khong keo duoc don ke tiep cho KTV cu:', errPromote.message);
                } else if (!(kqPromote as any)?.promoted_booking_id && viTriCu != null) {
                    await supabase
                        .from('TurnQueue')
                        .update({ queue_position: viTriCu })
                        .eq('id', q.id);
                }
            }
        }

        let parsedSegments = item.segments;
        let isSegString = typeof parsedSegments === 'string';
        if (isSegString) {
            try {
                parsedSegments = JSON.parse(parsedSegments);
            } catch {
                parsedSegments = [];
            }
        }
        let segments = Array.isArray(parsedSegments) ? [...parsedSegments] : [];
        
        // --- XỬ LÝ LƯƠNG & TUA KTV CŨ ---
        // Quy chế (chốt 06/09/2026): KTV bị đổi ra MẤT HẾT — tiền, giờ tích luỹ, tua.
        // Nhưng vẫn GIỮ trong đơn kèm số phút đã làm, để còn biết ai từng làm cho
        // khách và giải thích được khi đối soát. Cờ `voided` mới là thứ chặn tiền.
        // ⚠️ PHẢI dùng ktvMatchesSeg, đừng so `===`. `seg.ktvId` có thể là chặng
        // GHÉP nhiều người ("Bao - Na") và chữ hoa/thường không thống nhất
        // ("Bao - Na" vs "NA - BAO") — dữ liệu thật đang có cả hai kiểu. So bằng
        // `===` là không tìm thấy chặng cũ: nó KHÔNG bị đóng, KHÔNG bị tước, nên
        // KTV cũ vẫn ăn đủ tiền còn KTV mới được cộng thêm một chặng nữa.
        const aIndex = segments.findIndex(seg => ktvMatchesSeg(seg.ktvId, oldKtvId) && !seg.endTime);
        let oldWorkedMins = 0;
        const pauseTime = item.pauseStart || new Date().toISOString();
        if (aIndex !== -1) {
            const oldSeg = segments[aIndex];

            // Đóng khoảng tạm dừng còn hở tại mốc bấm dừng, rồi tính giờ làm thực
            // (đã trừ các lần dừng trước đó) — xem lib/segment-time.ts
            const closed = { ...oldSeg, pauses: Array.isArray(oldSeg.pauses) ? [...oldSeg.pauses] : [] };
            closeOpenPause(closed, pauseTime, 'SWAP');
            closed.endTime = pauseTime;
            closed.actualEndTime = pauseTime;

            // Tước sạch quyền lợi nhưng VẪN ghi số phút đã làm để đối soát.
            voidSegment(closed, pauseTime, 'CHANGED');
            oldWorkedMins = Number(closed.customCommissionDuration) || 0;

            segments[aIndex] = closed;
        }

        // --- NẾU CÓ KTV MỚI VÀO THAY ---
        if (newKtvId) {
            // Số phút KTV mới được tính:
            //   - assignedMins > 0 : quầy gán tay (đã kẹp trần bằng thời lượng dịch vụ)
            //   - còn lại          : phần còn lại của dịch vụ + giờ bù
            const remainingMins = assignedMins && assignedMins > 0
                ? Math.min(assignedMins, originalDuration)
                : Math.max(0, originalDuration - oldWorkedMins) + extraTimeMins;

            if (businessDate) {
                // Thêm tua cho KTV mới — CHỈ loại A/B/C. Loại D tính công bằng giờ
                // của chặng TAKEOVER ở dưới, không cần dòng sổ tua nào.
                // ⚠️ Sổ cái tua khoá theo ĐƠN CHA (RPC điều phối ghi
                // COALESCE(parent_booking_id, id)). Ghi bằng mã đơn con sẽ đẻ ra
                // dòng lệch khoá, không khớp với chỗ tước tua và chỗ đối soát.
                if (theoSoTua(newKtvId)) {
                    // upsert thay vì insert: bảng có UNIQUE (date, booking_id,
                    // employee_id). KTV mới đã có tua trên chính bill này (đang làm
                    // dịch vụ khác, hoặc từng bị đổi ra rồi đổi vào lại) thì insert
                    // vỡ khoá — trước đây lỗi bị nuốt vì không ai đọc `error`.
                    const { error: errTua } = await supabase
                        .from('TurnLedger')
                        .upsert({
                            date: businessDate,
                            employee_id: newKtvId,
                            booking_id: await ledgerBookingIdOf(supabase, item.bookingId),
                            counted_at: new Date().toISOString(),
                            source: 'SWAP_KTV',
                        }, { onConflict: 'date,booking_id,employee_id', ignoreDuplicates: true });
                    if (errTua) console.error('[swapKtv] khong ghi duoc tua cho KTV moi:', errTua.message);
                }

                // Kéo KTV mới lên working
                await supabase
                    .from('TurnQueue')
                    .update({ status: 'working', current_order_id: item.bookingId, booking_item_id: item.id })
                    .eq('employee_id', newKtvId)
                    .eq('date', businessDate);

                // Phiếu phân công cho KTV mới.
                // ⚠️ Trước 09/09/2026 luồng này chỉ đẩy TurnQueue sang 'working' mà
                // không tạo dòng nào ở KtvAssignments. Lần kế tiếp có ai gọi
                // `promote_next_assignment` cho họ: không thấy ACTIVE, cũng không
                // thấy QUEUED/READY → RPC dọn sạch TurnQueue về 'waiting', cướp mất
                // đơn đang làm dở ngay trên tay.
                const { error: errPhieu } = await supabase
                    .from('KtvAssignments')
                    .upsert({
                        employee_id: newKtvId,
                        business_date: businessDate,
                        booking_id: item.bookingId,
                        booking_item_id: bookingItemId,
                        status: 'ACTIVE',
                        dispatch_source: 'SWAP_KTV',
                        planned_start_time: new Date().toISOString(),
                    }, { onConflict: 'employee_id,booking_item_id' });
                if (errPhieu) {
                    // Không chặn luồng đổi người: đơn vẫn chạy nhờ TurnQueue.
                    console.error('[swapKtv] khong tao duoc phieu phan cong cho KTV moi:', errPhieu.message);
                }
            }
            
            segments.push({
                ktvId: newKtvId,
                startTime: new Date().toISOString(), 
                actualStartTime: new Date().toISOString(), // set để commission tính đúng
                endTime: null,
                duration: remainingMins, // để calculateItemExpectedDuration đọc
                customCommissionDuration: remainingMins,
                note: 'TAKEOVER'
            });
        }

        // --- CẬP NHẬT TECHNICIAN CODES ---
        // ⚠️ KHÔNG gỡ KTV cũ ra khỏi danh sách nữa (chốt 06/09/2026).
        // `technicianCodes` là nguồn dữ liệu DUY NHẤT mà sổ cái loại D, tiền A/B/C,
        // lịch sử KTV và thẻ Kanban đọc. Gỡ khỏi đó là KTV cũ biến mất sạch khỏi
        // đơn — không giải thích được cho họ, không thống kê được ai bị đổi.
        // Việc tước tiền/giờ do cờ `voided` trên chặng lo, tước tua do `is_punished`.
        let newTechCodes = Array.isArray(item.technicianCodes) ? [...item.technicianCodes] : [];
        if (newKtvId && !newTechCodes.includes(newKtvId)) {
            newTechCodes.push(newKtvId);
        }

        const { error: errUpdate } = await supabase
            .from('BookingItems')
            .update({
                technicianCodes: newTechCodes,
                segments: isSegString ? JSON.stringify(segments) as any : segments
            })
            .eq('id', bookingItemId);
            
        if (errUpdate) throw new Error('Lỗi khi cập nhật BookingItem.');

        // --- MẤT TUA CỦA KTV CŨ ---
        // ⚠️ PHẢI chạy SAU khi segments đã ghi xuống DB. punishTurnIfIdle đọc lại
        // BookingItems để xem KTV còn chặng nào chưa bị tước không — chạy trước
        // lệnh update ở trên thì nó thấy chặng cũ vẫn nguyên và bỏ qua, tua không
        // bao giờ bị tước.
        // Chỉ A/B/C. Loại D không có gì để tước ở đây: giờ tích luỹ của họ đã tụt
        // ngay khi chặng bị `voided` (KtvDLedgerEngine bỏ qua chặng voided), và
        // trigger trên BookingItems đã đẩy đơn vào KTVDRecomputeQueue để tính lại.
        if (businessDate && !keepTurnForOldKtv && theoSoTua(oldKtvId)) {
            await punishTurnIfIdle(supabase, {
                bookingId: item.bookingId,
                employeeId: oldKtvId,
                date: businessDate,
            });
        }

        const actorSwap = await currentCounterActor();
        await logCounterAction(supabase, [bookingItemId], {
            action: 'SWAP_KTV', by: actorSwap.id, byName: actorSwap.name,
            note: `${oldKtvId} → ${newKtvId || '(rút, chưa có người thay)'}`,
        });

        return { success: true };
    }
}
