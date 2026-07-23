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
    }> {
        try {
            const { data: staffData, error: staffErr } = await supabase
                .from('Staff')
                .select('feature_flags')
                .eq('id', input.staffId)
                .single();
            
            let targetHours = 80;
            if (!staffErr && staffData?.feature_flags) {
                let flags = staffData.feature_flags;
                if (typeof flags === 'string') {
                    try { flags = JSON.parse(flags); } catch {}
                }
                if (flags && typeof flags.kpi_target_hours === 'number') {
                    targetHours = flags.kpi_target_hours;
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

            if (ledgerData && ledgerData.total_minutes > 0) {
                totalMinutes = ledgerData.total_minutes;
            } else {
                const { data: dailyData, error: dailyErr } = await supabase
                    .from('KTVDailyLedger')
                    .select('total_minutes')
                    .eq('staff_id', input.staffId)
                    .gte('date', `${input.year}-${String(input.month).padStart(2, '0')}-01`)
                    .lte('date', `${input.year}-${String(input.month).padStart(2, '0')}-31`);

                if (!dailyErr && dailyData) {
                    totalMinutes += dailyData.reduce((acc, row) => acc + (row.total_minutes || 0), 0);
                }

                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();

                if (input.month === currentMonth && input.year === currentYear) {
                    const todayStr = now.toISOString().slice(0, 10);
                    const { data: todayBookings, error: todayErr } = await supabase
                        .from('BookingItems')
                        .select('segments')
                        .gte('timeStart', `${todayStr}T00:00:00`)
                        .lte('timeStart', `${todayStr}T23:59:59`)
                        .in('status', ['COMPLETED', 'DONE'])
                        .contains('technicianCodes', [input.staffId]);
                    
                    if (!todayErr && todayBookings) {
                        for (const item of todayBookings) {
                            let segs: any[] = [];
                            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
                            const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(input.staffId.toLowerCase()));
                            if (mySegs.length > 0) {
                                totalMinutes += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
                            }
                        }
                    }
                }
            }

            const totalHours = Number((totalMinutes / 60).toFixed(1));
            const progressPercent = Math.min(100, Math.round((totalHours / targetHours) * 100));
            const remainingHours = Math.max(0, targetHours - totalHours);

            return {
                totalMinutes,
                totalHours,
                targetHours,
                progressPercent,
                remainingHours
            };

        } catch (e: any) {
            console.error("Lỗi khi lấy KPI tháng:", e);
            return {
                totalMinutes: 0,
                totalHours: 0,
                targetHours: 80,
                progressPercent: 0,
                remainingHours: 80
            };
        }
    }
}
