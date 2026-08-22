import { SupabaseClient } from '@supabase/supabase-js';

export class KtvKpiService {
    static async getMonthlyHours(supabase: SupabaseClient, input: {
        staffId: string;
        month: number;
        year: number;
    }): Promise<{
        totalMinutes: number;
        totalHours: number;
        targetHours: number;
        progressPercent: number;
        remainingHours: number;
        workType: string;
    }> {
        try {
            const { data: staffData, error: staffErr } = await supabase
                .from('Staff')
                .select('feature_flags, work_type')
                .eq('id', input.staffId)
                .single();
            
            let targetHours = 80;
            if (!staffErr && staffData) {
                if (staffData.work_type !== 'TYPE_B') {
                    targetHours = 0; // KTV loại A, C không có chỉ tiêu mặc định
                }
                
                let flags = staffData.feature_flags;
                if (typeof flags === 'string') {
                    try { flags = JSON.parse(flags); } catch {}
                }
                if (flags && flags.kpi_target_hours) {
                    targetHours = typeof flags.kpi_target_hours === 'number' ? flags.kpi_target_hours : 80;
                }
            }

            const { data: ledgerData, error: ledgerErr } = await supabase
                .from('KTVMonthlyLedger')
                .select('total_minutes')
                .eq('staff_id', input.staffId)
                .eq('month', input.month)
                .eq('year', input.year)
                .maybeSingle();

            let totalMinutes = 0;

                // Fallback: Query all completed bookings for the requested month from BookingItems
                const startOfMonth = `${input.year}-${String(input.month).padStart(2, '0')}-01T00:00:00`;
                // Dùng ngày 31 cho mọi tháng (supabase tự hiểu lte)
                const endOfMonth = `${input.year}-${String(input.month).padStart(2, '0')}-31T23:59:59`;
                
                const { data: monthBookings, error: monthErr } = await supabase
                    .from('BookingItems')
                    .select('segments, Bookings!fk_bookingitems_booking!inner(bookingDate)')
                    .gte('Bookings.bookingDate', startOfMonth)
                    .lte('Bookings.bookingDate', endOfMonth)
                    .in('status', ['COMPLETED', 'DONE', 'CLEANING', 'FEEDBACK'])
                    .contains('technicianCodes', [input.staffId]);

                if (!monthErr && monthBookings) {
                    for (const item of monthBookings) {
                        let segs: any[] = [];
                        try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
                        const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(input.staffId.toLowerCase()));
                        if (mySegs.length > 0) {
                            totalMinutes += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
                        }
                    }
                }

            const totalHours = Number((totalMinutes / 60).toFixed(1));
            const progressPercent = targetHours > 0 ? Math.min(100, Math.round((totalHours / targetHours) * 100)) : 100;

            return {
                totalMinutes,
                totalHours: parseFloat(totalHours.toFixed(1)),
                targetHours,
                progressPercent,
                remainingHours: Math.max(0, parseFloat((targetHours - totalHours).toFixed(1))),
                workType: staffData?.work_type || 'TYPE_A'
            };
        } catch (e) {
            console.error('Lỗi tính KPI:', e);
            return {
                totalMinutes: 0,
                totalHours: 0,
                targetHours: 0,
                progressPercent: 0,
                remainingHours: 0,
                workType: 'TYPE_A'
            };
        }
    }
}
