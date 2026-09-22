import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixData() {
    console.log("Đang sửa dữ liệu cho NH001 ngày 15/05...");

    // 1. Giảm 50k ở Sổ Cái
    const { data: updateData, error: updateErr } = await supabase
        .from('KTVDailyLedger')
        .update({ total_commission: 150000 })
        .eq('staff_id', 'NH001')
        .eq('date', '2026-05-15');

    if (updateErr) {
        console.error("Lỗi update sổ cái:", updateErr);
    } else {
        console.log("✅ Đã giảm 50k trong Sổ Cái ngày 15/05 (Từ 200k xuống 150k).");
    }

    // 2. Thêm 50k vào Adjustments để Lịch sử đọc được
    // Cần kiểm tra xem đã bù chưa để tránh bị insert 2 lần
    const { data: checkAdj } = await supabase
        .from('WalletAdjustments')
        .select('*')
        .eq('staff_id', 'NH001')
        .like('reason', '%thiếu điều phối%');

    if (checkAdj && checkAdj.length > 0) {
        console.log("⚠️ Khoản bù này đã tồn tại, bỏ qua việc thêm mới.");
    } else {
        const { error: insertErr } = await supabase
            .from('WalletAdjustments')
            .insert({
                staff_id: 'NH001',
                amount: 50000,
                type: 'GIFT',
                reason: 'Bù tiền tua đơn hàng do lỗi thiếu điều phối',
                created_at: '2026-05-15T18:00:00.000Z'
            });

        if (insertErr) {
            console.error("Lỗi insert Adjustments:", insertErr);
        } else {
            console.log("✅ Đã tạo lệnh bù 50k (Wallet Adjustment) vào ngày 15/05.");
        }
    }
    
    console.log("Hoàn tất! Mọi thứ đã cân bằng hoàn hảo.");
}

fixData().catch(console.error);
