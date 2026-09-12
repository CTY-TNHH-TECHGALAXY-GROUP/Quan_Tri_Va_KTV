import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) supabaseKey = line.split('=')[1].trim();
});

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to fetch all rows with pagination
async function fetchAll(table, selectQuery) {
    let allData = [];
    let page = 0;
    const limit = 1000;
    
    while (true) {
        const { data, error } = await supabase
            .from(table)
            .select(selectQuery)
            .range(page * limit, (page + 1) * limit - 1);
            
        if (error) throw error;
        
        if (data && data.length > 0) {
            allData = allData.concat(data);
        }
        
        if (!data || data.length < limit) {
            break;
        }
        
        page++;
    }
    
    return allData;
}

async function scan() {
    console.log('🔄 Đang quét dữ liệu mồ côi (có phân trang)...');
    
    // Fetch all Booking IDs
    console.log('1. Lấy danh sách ID từ bảng Bookings...');
    const bookingsData = await fetchAll('Bookings', 'id, status');
    
    const validBookingIds = new Set(bookingsData.map(b => b.id));
    const bookingStatuses = new Map(bookingsData.map(b => [b.id, b.status]));

    console.log(`=> Đã lấy ${validBookingIds.size} đơn hàng gốc.`);

    // 1. TurnQueue mồ côi
    console.log('\n2. Kiểm tra TurnQueue...');
    const turnQueue = await fetchAll('TurnQueue', 'employee_id, date, current_order_id, booking_item_ids');

    const orphanTurnQueues = turnQueue.filter(t => t.current_order_id && !validBookingIds.has(t.current_order_id));
    console.log(`=> Phát hiện ${orphanTurnQueues.length} dòng TurnQueue mồ côi.`);

    // 2. TurnLedger mồ côi
    console.log('\n3. Kiểm tra TurnLedger...');
    const turnLedger = await fetchAll('TurnLedger', 'id, date, booking_id, employee_id');

    const orphanTurnLedgers = turnLedger.filter(t => t.booking_id && !validBookingIds.has(t.booking_id));
    console.log(`=> Phát hiện ${orphanTurnLedgers.length} dòng TurnLedger mồ côi.`);

    // 3. KtvAssignments mồ côi
    console.log('\n4. Kiểm tra KtvAssignments...');
    const assignments = await fetchAll('KtvAssignments', 'id, booking_id, employee_id, business_date');

    const orphanAssignments = assignments.filter(a => a.booking_id && !validBookingIds.has(a.booking_id));
    console.log(`=> Phát hiện ${orphanAssignments.length} dòng KtvAssignments mồ côi.`);

    // 4. Đơn kẹt trạng thái
    console.log('\n5. Kiểm tra Đơn kẹt trạng thái (Silent failures)...');
    const stuckStatuses = new Set(['NEW', 'WAITING', 'pending']);
    
    // Find fake IDs in assignments/ledgers, see if their base UUID is stuck
    const fakeIds = new Set([
        ...orphanTurnLedgers.map(t => t.booking_id),
        ...orphanAssignments.map(a => a.booking_id),
        ...orphanTurnQueues.map(t => t.current_order_id)
    ]);

    const stuckBookings = [];
    const suffixRegex = /-[A-Z]$/;
    
    for (const fakeId of fakeIds) {
        if (!suffixRegex.test(fakeId)) continue; // Must have suffix -A, -B, etc.
        
        // Extract baseId by removing the last 2 characters (e.g. "-A")
        const baseId = fakeId.slice(0, -2);
        
        if (validBookingIds.has(baseId) && stuckStatuses.has(bookingStatuses.get(baseId))) {
            if (!stuckBookings.find(b => b.baseId === baseId)) {
                stuckBookings.push({
                    baseId,
                    fakeId,
                    status: bookingStatuses.get(baseId)
                });
            }
        }
    }
    console.log(`=> Phát hiện ${stuckBookings.length} đơn hàng kẹt trạng thái (dù đã có lịch gán KTV dưới mã ảo).`);

    // Phân tích tổn thất tua (Từ TurnLedger)
    const discrepancyByKtv = {};
    let minDate = '9999-99-99';
    let maxDate = '0000-00-00';
    
    for (const t of orphanTurnLedgers) {
        if (!discrepancyByKtv[t.employee_id]) discrepancyByKtv[t.employee_id] = 0;
        discrepancyByKtv[t.employee_id]++;
        
        if (t.date < minDate) minDate = t.date;
        if (t.date > maxDate) maxDate = t.date;
    }

    const report = {
        orphanTurnQueues,
        orphanTurnLedgers,
        orphanAssignments,
        stuckBookings,
        summary: {
            totalTurnQueueOrphans: orphanTurnQueues.length,
            totalTurnLedgerOrphans: orphanTurnLedgers.length,
            totalKtvAssignmentsOrphans: orphanAssignments.length,
            totalStuckBookings: stuckBookings.length,
            turnLedgerDateRange: orphanTurnLedgers.length > 0 ? { minDate, maxDate } : null,
            estimatedExtraTurnsByKtv: discrepancyByKtv
        }
    };

    fs.writeFileSync('scan_orphan_report.json', JSON.stringify(report, null, 2), 'utf-8');
    console.log('\n✅ Quét hoàn tất. Đã lưu kết quả vào scan_orphan_report.json.');
    console.log('--- SUMMARY ---');
    console.log(JSON.stringify(report.summary, null, 2));
}

scan().catch(err => console.error('Lỗi khi quét:', err));
