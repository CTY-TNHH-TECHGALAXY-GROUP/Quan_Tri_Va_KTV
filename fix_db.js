// 🔍 DEBUG: Kiểm tra chi tiết tua của NH014 hôm nay
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
        env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function debugNH014() {
    const today = '2026-04-25';
    const fromFilter = `${today}T00:00:00`;
    const toFilter = `${today}T23:59:59`;

    console.log(`\n🔍 KIỂM TRA ĐƠN CỦA NH014 NGÀY ${today}`);
    console.log('='.repeat(80));

    // 1. Lấy tất cả Bookings hôm nay
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode, customerName, status, createdAt')
        .gte('createdAt', fromFilter)
        .lte('createdAt', toFilter)
        .order('createdAt', { ascending: true });

    let nh014Items = [];
    let nh014Bills = new Set();
    let pendingBills = new Set();
    let nameMismatch = [];

    for (const b of bookings) {
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, bookingId, technicianCodes, status, serviceId')
            .eq('bookingId', b.id);

        for (const item of (items || [])) {
            // Check if NH014 is involved (either by exact match or substring)
            let involved = false;
            let matchedName = null;
            
            if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                for (const code of item.technicianCodes) {
                    if (code === 'NH014') {
                        involved = true;
                        matchedName = code;
                    } else if (code.includes('NH014') || code.toLowerCase().includes('tiểu tiên')) { // Adding Tiểu Tiên just in case it's NH014's alias
                        // Just flag substring matches
                        if (!involved && code.includes('NH014')) {
                            nameMismatch.push({ bill: b.billCode, itemStatus: item.status, code: code });
                        }
                    }
                }
            }

            if (involved) {
                const isItemDone = ['COMPLETED', 'DONE'].includes(item.status);
                const isBookingDone = ['COMPLETED', 'DONE'].includes(b.status);
                const isCounted = isItemDone || isBookingDone;

                nh014Items.push({
                    billCode: b.billCode,
                    bookingStatus: b.status,
                    itemStatus: item.status,
                    serviceId: item.serviceId,
                    isCounted: isCounted
                });

                if (isCounted) {
                    nh014Bills.add(b.id);
                } else {
                    pendingBills.add(b.billCode);
                }
            }
        }
    }

    console.log('\n📋 CHI TIẾT CÁC ĐƠN CÓ MÃ "NH014":');
    nh014Items.forEach(i => {
        console.log(`   🔖 Bill: ${i.billCode.padEnd(15)} | Trạng thái Đơn: ${i.bookingStatus.padEnd(12)} | Trạng thái Dịch Vụ: ${i.itemStatus.padEnd(12)} -> Tính tua: ${i.isCounted ? '✅' : '❌'}`);
    });

    console.log('\n⚠️ CÁC TRƯỜNG HỢP SAI TÊN HOẶC CHỨA CHUỖI GỘP:');
    if (nameMismatch.length === 0) {
        console.log('   (Không có)');
    } else {
        nameMismatch.forEach(n => {
            console.log(`   🔖 Bill: ${n.bill} | Lưu sai định dạng: "${n.code}" (Cần lưu chính xác là ["NH014"])`);
        });
    }

    console.log('\n📊 TỔNG KẾT NH014:');
    console.log(`   - Tổng số tua (hoàn thành) đã tính: ${nh014Bills.size}`);
    console.log(`   - Các đơn chưa hoàn thành (chưa tính tua): ${pendingBills.size > 0 ? Array.from(pendingBills).join(', ') : '(Không có)'}`);

}

debugNH014().catch(console.error);
