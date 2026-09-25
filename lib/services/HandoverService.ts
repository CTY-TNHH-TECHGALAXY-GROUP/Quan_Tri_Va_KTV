import { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notification-helper';
import { KtvDisciplineService } from './KtvDisciplineService';

// =====================================================
// HandoverService — S.O.L.I.D Service Layer
// Plan: plan_handover_review_v5.md
// Single Responsibility: All handover logic lives here.
// =====================================================

// 🔧 TYPES
export interface HandoverChecklistItem {
    label: string;
    source: 'room' | 'service'; // Where this item came from
}

export interface ServiceMapping {
    items: string[];
    apply_categories: string[];
    apply_services: string[];
}

export interface HandoverMappingConfig {
    [key: string]: ServiceMapping;
}

export type RejectOption = 'REDO' | 'PENALIZE_ONLY';

// =====================================================
// MAIN SERVICE CLASS
// =====================================================
export class HandoverService {

    /**
     * Generate dynamic checklist for a KTV based on their Room + Service.
     * Room checklist = base items from Rooms.handover_checklist
     * Service checklist = items matched by category or service code from SystemConfigs mapping
     * 
     * RULE: Room checklist only shows for the LAST KTV finishing in that room.
     */
    static async generateDynamicChecklist(
        supabase: SupabaseClient,
        roomId: string | null,
        serviceCode: string,
        serviceCategory: string,
        bookingId: string,
        bookingItemId: string,
        serviceId?: string // 🆕 Thêm tham số này để fallback nếu code/category rỗng
    ): Promise<HandoverChecklistItem[]> {
        const checklist: HandoverChecklistItem[] = [];

        // TỐI ƯU HIỆU NĂNG: Chạy 4 câu truy vấn độc lập song song cùng lúc (Parallel Fetching)
        const remainingInRoomPromise = roomId 
            ? supabase
                .from('BookingItems')
                .select('id', { count: 'exact', head: true })
                .eq('bookingId', bookingId)
                .eq('roomName', roomId)
                .neq('id', bookingItemId)
                .in('status', ['PENDING', 'IN_PROGRESS'])
            : Promise.resolve({ count: 0 });

        const roomPromise = roomId
            ? supabase
                .from('Rooms')
                .select('handover_checklist')
                .eq('id', roomId)
                .single()
            : Promise.resolve({ data: null });

        const configPromise = supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'handover_service_mapping')
            .single();

        // 🆕 Truy vấn bù thông tin Service nếu thiếu
        const servicePromise = (serviceId && (!serviceCode || !serviceCategory))
            ? supabase
                .from('Services')
                .select('code, category')
                .eq('id', serviceId)
                .single()
            : Promise.resolve({ data: null });

        const [remainingInRoomRes, roomRes, configRes, serviceRes] = await Promise.all([
            remainingInRoomPromise,
            roomPromise,
            configPromise,
            servicePromise
        ]);

        const remainingInRoom = remainingInRoomRes.count;
        const isLastKtvInRoom = (remainingInRoom || 0) === 0;

        // Xử lý checklist Phòng (nếu là KTV cuối cùng)
        if (isLastKtvInRoom) {
            const room = roomRes.data;
            if (room?.handover_checklist && Array.isArray(room.handover_checklist)) {
                room.handover_checklist.forEach((item: string) => {
                    checklist.push({ label: item, source: 'room' });
                });
            }
        }

        // Xử lý checklist Dịch vụ
        const configRow = configRes.data;
        const fallbackSvc = serviceRes.data;

        // Ưu tiên dùng code/category truyền vào, nếu không có thì lấy từ DB (serviceRes)
        const finalCode = (serviceCode || fallbackSvc?.code || '').trim().toUpperCase();
        
        const finalCats: string[] = [];
        const catSource = serviceCategory || fallbackSvc?.category;
        if (Array.isArray(catSource)) {
            finalCats.push(...catSource.map(c => String(c).trim().toLowerCase()));
        } else if (typeof catSource === 'string') {
            try {
                const parsed = JSON.parse(catSource);
                if (Array.isArray(parsed)) {
                    finalCats.push(...parsed.map(c => String(c).trim().toLowerCase()));
                } else {
                    finalCats.push(catSource.trim().toLowerCase());
                }
            } catch {
                finalCats.push(catSource.trim().toLowerCase());
            }
        }

        if (configRow?.value) {
            let mapping: HandoverMappingConfig;
            try {
                mapping = typeof configRow.value === 'string'
                    ? JSON.parse(configRow.value)
                    : configRow.value;
            } catch {
                mapping = {};
            }

            // 4. Match by category OR service code
            for (const group of Object.values(mapping)) {
                const matchesCat = group.apply_categories?.some(
                    (cat: string) => finalCats.includes(cat.toLowerCase())
                );
                const matchesSvc = group.apply_services?.some(
                    (code: string) => code.toUpperCase() === finalCode
                );

                if (matchesCat || matchesSvc) {
                    group.items.forEach((item: string) => {
                        // Deduplicate
                        if (!checklist.some(c => c.label === item)) {
                            checklist.push({ label: item, source: 'service' });
                        }
                    });
                }
            }
        }

        return checklist;
    }

    /**
     * KTV submits handover images.
     * Images should already be uploaded to Supabase Storage.
     * This method saves the URLs to BookingItems.handover_images.
     */
    static async submitHandover(
        supabase: SupabaseClient,
        itemId: string,
        images: Record<string, string[]> // { "Máy lạnh": ["url1", "url2"], ... }
    ): Promise<{ success: boolean; error?: string }> {
        const { error } = await supabase
            .from('BookingItems')
            .update({
                handover_images: images,
                handover_status: 'PENDING',
                handover_skipped: false,
            })
            .eq('id', itemId);

        if (error) return { success: false, error: error.message };
        return { success: true };
    }

    /**
     * KTV skips handover (has next order to attend).
     * Checks max_handover_skip limit (Loophole #1).
     */
    static async skipHandover(
        supabase: SupabaseClient,
        itemId: string,
        ktvCode: string
    ): Promise<{ success: boolean; error?: string }> {
        // 1. Check how many pending skips this KTV already has
        const { data: configRow } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'max_handover_skip')
            .single();

        const maxSkip = parseInt(configRow?.value || '2', 10);

        const { count: currentSkips } = await supabase
            .from('BookingItems')
            .select('id', { count: 'exact', head: true })
            .eq('handover_skipped', true)
            .eq('handover_status', 'SKIPPED')
            .contains('technicianCodes', [ktvCode]);

        if ((currentSkips || 0) >= maxSkip) {
            return {
                success: false,
                error: `Bạn đã nợ ${currentSkips} đơn bàn giao. Vui lòng bàn giao đơn cũ trước.`
            };
        }

        // 2. Mark as skipped
        const { error } = await supabase
            .from('BookingItems')
            .update({
                handover_skipped: true,
                handover_status: 'SKIPPED',
            })
            .eq('id', itemId);

        if (error) return { success: false, error: error.message };
        return { success: true };
    }

    /**
     * Get list of pending handovers for a KTV (for Dashboard reminder widget).
     */
    static async getPendingHandovers(
        supabase: SupabaseClient,
        ktvCode: string
    ): Promise<{ items: any[]; count: number }> {
        const { data, error } = await supabase
            .from('BookingItems')
            .select(`
                id, bookingId, roomId, serviceCode, handover_status, handover_skipped,
                Bookings(billCode)
            `)
            .or('handover_skipped.eq.true,handover_status.eq.REJECTED')
            .in('handover_status', ['SKIPPED', 'REJECTED'])
            .contains('technicianCodes', [ktvCode]);

        if (error) return { items: [], count: 0 };
        return { items: data || [], count: data?.length || 0 };
    }

    /**
     * Reception reviews handover: Approve, or Reject with 3 options.
     * Option 1 (REDO): Push back to CLEANING, max 2 times (Loophole #3).
     * Option 2 (DEDUCT): Deduct money via WalletAdjustment.
     * Option 3 (CONFISCATE): Lock commission entirely.
     */
    static async rejectHandover(
        supabase: SupabaseClient,
        itemId: string,
        option: RejectOption,
        reason: string,
        ktvCode?: string,
        rejectImagesUrls?: string[],
        deductPoints?: boolean
    ): Promise<{ success: boolean; error?: string }> {
        // 1. Fetch current item state
        const { data: item, error: fetchErr } = await supabase
            .from('BookingItems')
            .select('id, bookingId, handover_reject_count, technicianCodes, handover_reject_images, Bookings!fk_bookingitems_booking(billCode, parent_booking_id, sub_suffix)')
            .eq('id', itemId)
            .single();

        if (fetchErr) {
            console.error('[HandoverService] fetchErr:', fetchErr);
            return { success: false, error: `Lỗi DB: ${fetchErr.message}` };
        }
        if (!item) return { success: false, error: 'Item not found' };

        // Xử lý billCode cho đơn đã tách (Sub-booking)
        let displayBillCode = (item as any).Bookings?.billCode || '';
        let subSuffix = (item as any).Bookings?.sub_suffix || '';
        
        if ((item as any).Bookings?.parent_booking_id && !displayBillCode) {
            const { data: parentBooking } = await supabase
                .from('Bookings')
                .select('billCode')
                .eq('id', (item as any).Bookings.parent_booking_id)
                .single();
            if (parentBooking?.billCode) {
                displayBillCode = parentBooking.billCode;
            }
        }
        const fullBillCode = displayBillCode ? `${displayBillCode}${subSuffix ? `-${subSuffix}` : ''}` : '';

        const currentCount = item.handover_reject_count || 0;
        const oldRejectImages = Array.isArray(item.handover_reject_images) ? item.handover_reject_images : [];
        const newRejectImages = [...oldRejectImages, ...(rejectImagesUrls || [])];

        // 2. Get max reject config
        const { data: configRow } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'max_handover_reject')
            .single();
        const maxReject = parseInt(configRow?.value || '2', 10);

        // 3. Process by option
        switch (option) {
            case 'REDO': {
                if (currentCount >= maxReject) {
                    return {
                        success: false,
                        error: `Đã đạt giới hạn ${maxReject} lần dọn lại. Vui lòng chọn Trừ tiền hoặc Tước tiền.`
                    };
                }

                // Push back to CLEANING
                const updatePayload: any = {
                    handover_status: 'REJECTED',
                    handover_reject_action: 'REDO',
                    handover_reject_count: currentCount + 1,
                    handover_comment: reason,
                    status: 'CLEANING', // Push back
                };
                if (rejectImagesUrls && rejectImagesUrls.length > 0) {
                    updatePayload.handover_reject_images = newRejectImages;
                }

                const { error: updateErr } = await supabase
                    .from('BookingItems')
                    .update(updatePayload)
                    .eq('id', itemId);

                if (updateErr) return { success: false, error: updateErr.message };

                // Send notification to KTV
                const techCodes: string[] = item.technicianCodes || [];
                for (const tc of techCodes) {
                    await createNotification({
                        type: 'HANDOVER_REJECTED',
                        employeeId: tc,
                        message: `⚠️ Hình bàn giao đơn #${fullBillCode} bị từ chối: ${reason}. Vui lòng dọn lại. (Lần ${currentCount + 1}/${maxReject})`,
                        bookingId: item.bookingId,
                    });
                    
                    if (deductPoints) {
                        await KtvDisciplineService.deductPoints(
                            supabase,
                            tc,
                            'HANDOVER_REJECT',
                            `Phạt dọn lại: ${reason} (Đơn #${fullBillCode})`,
                            false,
                            item.bookingId,
                            newRejectImages
                        );
                        
                        await createNotification({
                            type: 'DISCIPLINE',
                            employeeId: tc,
                            message: `⚠️ Bạn bị gắn cờ vi phạm: Trừ 5đ chuyên cần. Lý do: ${reason}`,
                            bookingId: item.bookingId,
                        });
                    }
                }
                break;
            }

            case 'PENALIZE_ONLY': {
                // Duyệt bàn giao (để tiếp tục flow) nhưng lưu lỗi vi phạm
                const { error: updateErr } = await supabase
                    .from('BookingItems')
                    .update({
                        handover_status: 'APPROVED',
                        handover_reject_action: 'PENALIZE_ONLY',
                        handover_comment: reason,
                        handover_reject_images: newRejectImages, // có thể lưu ảnh minh chứng
                    })
                    .eq('id', itemId);

                if (updateErr) return { success: false, error: updateErr.message };

                // Tạo kỷ luật (phạt điểm) nếu deductPoints
                const techCodes: string[] = item.technicianCodes || [];
                for (const tc of techCodes) {
                    if (deductPoints) {
                        await KtvDisciplineService.deductPoints(
                            supabase,
                            tc,
                            'HANDOVER_REJECT',
                            `Lỗi bàn giao phòng: ${reason} (Đơn #${fullBillCode})`,
                            false,
                            item.bookingId,
                            newRejectImages
                        );
                        
                        await createNotification({
                            type: 'DISCIPLINE',
                            employeeId: tc,
                            message: `⚠️ Bạn bị gắn cờ vi phạm: Trừ 5đ chuyên cần. Lý do: ${reason}`,
                            bookingId: item.bookingId,
                        });
                    } else {
                        // Nếu lễ tân chọn PENALIZE_ONLY nhưng KHÔNG tick deductPoints? 
                        // (Trên UI đã chặn việc này, nhưng để chắc chắn ta push 1 thông báo thường)
                        await createNotification({
                            type: 'SYSTEM',
                            employeeId: tc,
                            message: `Cảnh cáo bàn giao đơn #${fullBillCode}: ${reason}`,
                            bookingId: item.bookingId,
                        });
                    }
                }
                break;
            }
        }

        return { success: true };
    }

    /**
     * Approve handover (Quầy duyệt).
     */
    static async approveHandover(
        supabase: SupabaseClient,
        itemId: string
    ): Promise<{ success: boolean; error?: string }> {
        const { error } = await supabase
            .from('BookingItems')
            .update({
                handover_status: 'APPROVED',
                handover_skipped: false,
            })
            .eq('id', itemId);

        if (error) return { success: false, error: error.message };
        return { success: true };
    }

    /**
     * Auto-approve expired handovers (Cron job — Loophole #2).
     * Approves handovers that have been PENDING for more than X minutes.
     */
    static async autoApproveExpired(
        supabase: SupabaseClient
    ): Promise<{ approved: number }> {
        // Get timeout config
        const { data: configRow } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'reception_auto_approve_minutes')
            .single();
        const timeoutMinutes = parseInt(configRow?.value || '15', 10);

        const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

        // Find items that are PENDING and were submitted before cutoff
        // We use updated_at as the submission time proxy
        const { data: expired, error } = await supabase
            .from('BookingItems')
            .select('id')
            .eq('handover_status', 'PENDING')
            .eq('handover_skipped', false)
            .lt('updated_at', cutoff);

        if (error || !expired?.length) return { approved: 0 };

        const ids = expired.map(e => e.id);
        const { error: updateErr } = await supabase
            .from('BookingItems')
            .update({ handover_status: 'APPROVED' })
            .in('id', ids);

        if (updateErr) return { approved: 0 };
        return { approved: ids.length };
    }
}
