import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { KtvTypeDCommissionService } from '../lib/services/KtvTypeDCommissionService';
import { KtvTypeDBonusService } from '../lib/services/KtvTypeDBonusService';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY! || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const args = process.argv.slice(2);
    // Ngày hệ thống đưa vào hoạt động loại D thường tầm đầu T8/T9
    const startDateStr = args[0] || '2026-08-01'; 
    const endDateStr = args[1] || '2026-09-02';

    console.log(`Auditing Type D Wallet from ${startDateStr} to ${endDateStr}`);

    // Fetch System Configs
    const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
    const configs: Record<string, any> = {};
    (configsData || []).forEach((c: any) => { configs[c.key] = c.value; });

    // Lấy config bonus hệ thống (không chỉ type_d) để lấy ktv_bonus_rate_TYPE_D
    const { data: allConfigsData } = await supabase.from('SystemConfigs').select('key, value');
    const allConfigs: Record<string, any> = {};
    (allConfigsData || []).forEach((c: any) => { allConfigs[c.key] = c.value; });

    const rateVIP = Number(configs['ktv_type_d_vip_rate_per_60m']) || 180000;
    const ratePT = Number(configs['ktv_type_d_pt_rate_per_60m']) || 100000;
    
    let ratingDeductions = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
    if (configs['ktv_type_d_rating_deduction']) {
        ratingDeductions = typeof configs['ktv_type_d_rating_deduction'] === 'string' 
            ? JSON.parse(configs['ktv_type_d_rating_deduction']) 
            : configs['ktv_type_d_rating_deduction'];
    }

    const basePoints = Number(configs['ktv_type_d_bonus_points']) || 20;
    const pointRate = Number(allConfigs['ktv_bonus_rate_TYPE_D']) || 1000;

    // Fetch KTVs
    const { data: ktvs } = await supabase.from('Staff').select('id, full_name, feature_flags').eq('work_type', 'TYPE_D');
    if (!ktvs || ktvs.length === 0) {
        console.log('No TYPE_D KTVs found.');
        return;
    }
    
    // Fetch all tech work types for bonus calculation
    const { data: allTechData } = await supabase.from('Staff').select('id, work_type');
    const techWorkTypeMap: Record<string, string> = {};
    (allTechData || []).forEach((t: any) => { techWorkTypeMap[t.id.toLowerCase()] = t.work_type; });

    // Fetch services to check utility
    const { data: services } = await supabase.from('Services').select('id, is_utility');
    const svcIsUtilityMap: Record<string, boolean> = {};
    (services || []).forEach((s: any) => { svcIsUtilityMap[String(s.id)] = !!s.is_utility; });

    let csvContent = `ktv_id,ktv_name,date,ledger_commission (VND),ledger_bonus (DIEM),dung_luat_commission (VND),dung_luat_bonus (VND),chenh_lech_commission (VND),chenh_lech_bonus (VND)\n`;
    
    const summaryByKtv: Record<string, any> = {};

    for (const ktv of ktvs) {
        summaryByKtv[ktv.id] = { name: ktv.full_name, diff_comm: 0, diff_bonus: 0 };
        
        let current = new Date(startDateStr);
        const end = new Date(endDateStr);
        
        while (current <= end) {
            const dateStr = current.toISOString().split('T')[0];
            
            // Get ledger
            const { data: ledgerData } = await supabase
                .from('KTVDailyLedger')
                .select('total_commission, total_bonus')
                .eq('staff_id', ktv.id)
                .eq('date', dateStr)
                .single();
                
            const ledgerComm = ledgerData ? Number(ledgerData.total_commission || 0) : 0;
            const ledgerBonusPoints = ledgerData ? Number(ledgerData.total_bonus || 0) : 0;
            const ledgerBonusVND = ledgerBonusPoints * pointRate;
            
            // Calculate real value
            const startTimeStr = `${dateStr}T00:00:00+07:00`;
            const endTimeStr = `${dateStr}T23:59:59.999+07:00`;
            
            // Dùng bookingDate theo đúng sync-daily-ledger
            const { data: bookings } = await supabase
                .from('Bookings')
                .select(`
                    id, rating, bookingDate, timeStart,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options )
                `)
                .gte('bookingDate', startTimeStr)
                .lte('bookingDate', endTimeStr)
                .not('status', 'in', '("CANCELLED","NEW")');
                
            let dungLuatComm = 0;
            let dungLuatBonus = 0;
            
            if (bookings && bookings.length > 0) {
                for (const b of bookings) {
                    const relevantItemsOriginal = (b.BookingItems || []).filter((i: any) =>
                        i.technicianCodes && Array.isArray(i.technicianCodes) &&
                        i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(ktv.id.toLowerCase())) &&
                        ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'].includes(i.status)
                    );

                    let relevantItems = relevantItemsOriginal.filter((i: any) => !svcIsUtilityMap[String(i.serviceId)]);
                    if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                        relevantItems = relevantItemsOriginal;
                    }

                    if (relevantItems.length === 0) continue;

                    const vipItems = relevantItems.filter((i: any) => {
                        const svcId = String(i.serviceId).toUpperCase();
                        return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
                    });
                    const ptItems = relevantItems.filter((i: any) => {
                        const svcId = String(i.serviceId).toUpperCase();
                        return !(svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP'));
                    });

                    dungLuatComm += KtvTypeDCommissionService.calculateGuestCommission(vipItems, ktv.id, b.rating, rateVIP, ratingDeductions);
                    dungLuatComm += KtvTypeDCommissionService.calculateGuestCommission(ptItems, ktv.id, b.rating, ratePT, ratingDeductions);

                    // Bonus
                    // Check enable bonus per staff
                    // default true
                    const flagData = typeof ktv.feature_flags === 'string' ? JSON.parse(ktv.feature_flags) : ktv.feature_flags;
                    const ktvCanBonus = flagData?.enable_bonus ?? true;
                    if (ktvCanBonus) {
                        const ktvWorkTypesForGuest: string[] = [];
                        (b.BookingItems || []).forEach((i: any) => {
                            if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                                i.technicianCodes.forEach((tc: string) => {
                                    const wt = techWorkTypeMap[tc.toLowerCase()] || 'TYPE_A';
                                    ktvWorkTypesForGuest.push(wt);
                                });
                            }
                        });
                        
                        dungLuatBonus += KtvTypeDBonusService.calculateBonusForTypeD(
                            ktvWorkTypesForGuest,
                            b.rating,
                            basePoints,
                            pointRate
                        );
                    }
                }
            }
            
            const diffComm = dungLuatComm - ledgerComm;
            const diffBonus = dungLuatBonus - ledgerBonusVND; 
            
            if (ledgerData || (bookings && bookings.some(b => b.BookingItems && b.BookingItems.some(i => i.technicianCodes && i.technicianCodes.includes(ktv.id))))) {
                csvContent += `${ktv.id},${ktv.full_name},${dateStr},${ledgerComm},${ledgerBonusPoints},${dungLuatComm},${dungLuatBonus},${diffComm},${diffBonus}\n`;
                summaryByKtv[ktv.id].diff_comm += diffComm;
                summaryByKtv[ktv.id].diff_bonus += diffBonus;
            }
            
            current.setDate(current.getDate() + 1);
        }
    }
    
    const outputPath = path.join(__dirname, 'output', 'type_d_audit.csv');
    fs.writeFileSync(outputPath, csvContent);
    console.log(`Exported CSV to ${outputPath}`);
    
    console.log('\n--- TỔNG CHÊNH LỆCH THEO KTV ---');
    console.log('KTV_ID | Tên | Chênh lệch Commission (VNĐ) | Chênh lệch Bonus (VNĐ)');
    for (const ktvId in summaryByKtv) {
        const sum = summaryByKtv[ktvId];
        console.log(`${ktvId} | ${sum.name} | ${sum.diff_comm.toLocaleString()} | ${sum.diff_bonus.toLocaleString()}`);
    }
}

main().catch(console.error);
