import { SupabaseClient } from '@supabase/supabase-js';

export class KtvDisciplineService {
    /**
     * Khởi tạo hoặc lấy số điểm chuyên cần của KTV trong tháng.
     * Dùng Lazy Evaluation: nếu chưa có record của tháng này thì tạo mới với 100đ.
     */
    static async initOrGetMonthlyPoints(supabase: SupabaseClient, staffId: string, month: number, year: number) {
        // Cố gắng fetch trước
        let { data, error } = await supabase
            .from('KTVDisciplinePoints')
            .select('*')
            .eq('staff_id', staffId)
            .eq('month', month)
            .eq('year', year)
            .maybeSingle();

        if (error) {
            console.error('Lỗi khi fetch KTVDisciplinePoints:', error);
            throw error;
        }

        // Nếu chưa có, tạo mới
        if (!data) {
            const { data: newData, error: insertError } = await supabase
                .from('KTVDisciplinePoints')
                .insert({
                    staff_id: staffId,
                    month: month,
                    year: year,
                    total_points: 100
                })
                .select()
                .single();

            if (insertError) {
                // Handle race condition (someone else inserted at the same time)
                if (insertError.code === '23505') {
                    const { data: retryData } = await supabase
                        .from('KTVDisciplinePoints')
                        .select('*')
                        .eq('staff_id', staffId)
                        .eq('month', month)
                        .eq('year', year)
                        .single();
                    return retryData;
                }
                console.error('Lỗi khi khởi tạo điểm:', insertError);
                throw insertError;
            }
            return newData;
        }

        return data;
    }

    /**
     * Lấy danh sách rules từ SystemConfigs
     */
    static async getDisciplineRules(supabase: SupabaseClient) {
        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'ktv_discipline_rules')
            .single();

        if (error || !data || !data.value) {
            return [
                { code: 'RECEPTION_COMPLAINT', name: 'Quầy complain', points: 5 },
                { code: 'HANDOVER_REJECT', name: 'Lỗi bàn giao quầy không duyệt', points: 5 },
                { code: 'ORDER_REJECT', name: 'Từ chối nhận đơn hàng', points: 10 }
            ];
        }

        return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    }

    static async calculateContinuousWorkMins(supabase: SupabaseClient, staffId: string): Promise<{ totalMins: number, lastEndTime: Date | null }> {
        const { data: gapData } = await supabase.from('SystemConfigs').select('value').eq('key', 'ktv_continuous_work_gap_mins').single();
        const gapMinsAllowed = gapData?.value ? Number(gapData.value) : 30;

        const now = new Date();
        const vnOffset = 7 * 60 * 60 * 1000;
        
        // Tính mốc 00:00:00 và 23:59:59 giờ Việt Nam, sau đó convert sang UTC để query
        const vnNow = new Date(now.getTime() + vnOffset);
        const vnStartOfDay = new Date(vnNow.getTime());
        vnStartOfDay.setUTCHours(0, 0, 0, 0);
        const utcStartOfDay = new Date(vnStartOfDay.getTime() - vnOffset);
        
        const vnEndOfDay = new Date(vnNow.getTime());
        vnEndOfDay.setUTCHours(23, 59, 59, 999);
        const utcEndOfDay = new Date(vnEndOfDay.getTime() - vnOffset);

        const { data: items, error } = await supabase
            .from('BookingItems')
            .select(`
                id, status, segments,
                Bookings!fk_bookingitems_booking!inner(timeStart)
            `)
            .contains('technicianCodes', [staffId])
            .gte('Bookings.timeStart', utcStartOfDay.toISOString())
            .lte('Bookings.timeStart', utcEndOfDay.toISOString())
            .in('status', ['IN_PROGRESS', 'COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE']);

        if (error || !items || items.length === 0) return { totalMins: 0, lastEndTime: null };

        const intervals: { start: number, end: number }[] = [];

        for (const item of items) {
            let segs = item.segments;
            if (typeof segs === 'string') {
                try { segs = JSON.parse(segs); } catch (e) { segs = []; }
            }
            if (!Array.isArray(segs)) segs = [];

            const mySegs = segs.filter((s: any) => 
                s.ktvId === staffId || 
                (Array.isArray(s.ktvId) && s.ktvId.includes(staffId)) || 
                (s.ktvInfo && s.ktvInfo.code === staffId) ||
                (s.technicianCodes && s.technicianCodes.includes(staffId))
            );

            for (const s of mySegs) {
                if (s.actualStartTime) {
                    const startMs = new Date(s.actualStartTime).getTime();
                    const endMs = s.actualEndTime ? new Date(s.actualEndTime).getTime() : now.getTime();
                    intervals.push({ start: startMs, end: endMs });
                }
            }
        }

        if (intervals.length === 0) return { totalMins: 0, lastEndTime: null };

        // Sắp xếp các khoảng thời gian giảm dần (mới nhất đầu tiên)
        intervals.sort((a, b) => b.start - a.start);

        let blockStart = intervals[0].start;
        let blockEnd = intervals[0].end;

        for (let i = 1; i < intervals.length; i++) {
            const int = intervals[i];
            const gap = (blockStart - int.end) / 60000;
            if (gap <= gapMinsAllowed) {
                blockStart = Math.min(blockStart, int.start);
                blockEnd = Math.max(blockEnd, int.end);
            } else {
                break;
            }
        }
        
        const gapToNow = (now.getTime() - blockEnd) / 60000;
        if (gapToNow > gapMinsAllowed) {
            return { totalMins: 0, lastEndTime: null };
        }

        const totalMins = (blockEnd - blockStart) / 60000;
        return { totalMins: Math.max(0, Math.round(totalMins)), lastEndTime: new Date(blockEnd) };
    }

    /**
     * Thực hiện phạt điểm KTV, ghi lịch sử và kiểm tra điều kiện giáng chức
     */
    static async deductPoints(
        supabase: SupabaseClient,
        staffId: string,
        ruleCode: string,
        note?: string,
        isExempted: boolean = false,
        bookingId?: string,
        images?: string[]
    ) {
        const date = new Date();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();

        const rules = await this.getDisciplineRules(supabase);
        const rule = rules.find((r: any) => r.code === ruleCode);
        const penaltyPoints = isExempted ? 0 : (rule ? rule.points : 5); 

        const pointsRecord = await this.initOrGetMonthlyPoints(supabase, staffId, month, year);

        let newTotal = pointsRecord.total_points;
        if (!isExempted) {
            newTotal = Math.max(0, pointsRecord.total_points - penaltyPoints);

            const { error: updateError } = await supabase
                .from('KTVDisciplinePoints')
                .update({
                    total_points: newTotal,
                    updated_at: new Date().toISOString()
                })
                .eq('id', pointsRecord.id);

            if (updateError) {
                console.error('Lỗi khi update KTVDisciplinePoints:', updateError);
                throw updateError;
            }
        }

        const { error: ledgerError } = await supabase
            .from('KTVDisciplineLedger')
            .insert({
                staff_id: staffId,
                rule_code: ruleCode,
                points_deducted: penaltyPoints,
                reason: note || (rule ? rule.name : ruleCode),
                is_exempted: isExempted,
                booking_id: bookingId || null,
                images: images || []
            });

        if (ledgerError) {
            console.error('Lỗi khi ghi KTVDisciplineLedger:', ledgerError);
        }

        if (!isExempted) {
            await this.checkAndDemote(supabase, staffId, newTotal);
        }

        return { success: true, newTotal, penaltyPoints, isExempted };
    }

    /**
     * Kiểm tra điểm chuyên cần:
     * - Nếu 80 <= điểm <= 85: Gửi cảnh báo
     * - Nếu < 80: Giáng chức xuống Loại A (nếu đang là Loại B)
     */
    static async checkAndDemote(supabase: SupabaseClient, staffId: string, currentPoints: number) {
        if (currentPoints > 85) return;

        const { data: staffData, error: staffError } = await supabase
            .from('Staff')
            .select('work_type, full_name')
            .eq('id', staffId)
            .single();

        if (staffError || !staffData) {
            console.error('Không tìm thấy KTV để kiểm tra giáng chức:', staffError);
            return;
        }

        const thresholdData = await supabase.from('SystemConfigs').select('value').eq('key', 'ktv_discipline_demotion_threshold').single();
        const threshold = thresholdData.data?.value ? Number(thresholdData.data.value) : 80;

        // CẢNH BÁO
        if (currentPoints >= threshold && currentPoints <= 85) {
            await supabase.from('StaffNotifications').insert({
                employeeId: staffId,
                type: 'WARNING',
                message: `⚠️ CẢNH BÁO: Điểm chuyên cần của bạn đang là ${currentPoints}/100. Vi phạm 1 lần nữa sẽ bị rớt hạng! Hãy chú ý.`
            });
            return;
        }

        // GIÁNG CHỨC
        if (currentPoints < threshold && staffData.work_type === 'TYPE_B') {
            console.log(`Tiến hành giáng chức KTV ${staffId} từ TYPE_B xuống TYPE_A (Điểm: ${currentPoints})`);
            
            const { error: updateStaffError } = await supabase
                .from('Staff')
                .update({ work_type: 'TYPE_A' })
                .eq('id', staffId);

            if (!updateStaffError) {
                // Báo cho Lễ tân/Admin
                await supabase.from('StaffNotifications').insert({
                    employeeId: null,
                    type: 'COMPLAINT',
                    message: `Hệ thống đã tự động giáng chức KTV ${staffData.full_name} (${staffId}) xuống LOẠI A do điểm chuyên cần tụt dưới ngưỡng (${currentPoints}đ).`
                });
                
                // Báo cho KTV
                await supabase.from('StaffNotifications').insert({
                    employeeId: staffId,
                    type: 'COMPLAINT',
                    message: `🚨 BẠN ĐÃ BỊ GIÁNG CHỨC XUỐNG LOẠI A do điểm chuyên cần tháng này giảm còn ${currentPoints}đ.`
                });
            }
        }
    }
}
