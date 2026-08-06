import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvDisciplineService } from './lib/services/KtvDisciplineService.js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSimulation() {
    console.log('====================================================');
    console.log('🏃 BẮT ĐẦU MÔ PHỎNG HỆ THỐNG ĐIỂM KỶ LUẬT KTV');
    console.log('====================================================');

    const testStaffId = 'TEST_KTV_001';
    
    // 1. Dọn dẹp dữ liệu cũ (nếu có)
    console.log('\n🧹 Đang dọn dẹp dữ liệu test cũ...');
    await supabase.from('KTVDisciplinePoints').delete().eq('staff_id', testStaffId);
    await supabase.from('KTVDisciplineLedger').delete().eq('staff_id', testStaffId);
    await supabase.from('Staff').delete().eq('id', testStaffId);

    // 2. Tạo KTV test mới (Mặc định là TYPE_B)
    console.log(`\n👤 Tạo KTV ảo với TYPE_B (Mã: ${testStaffId})...`);
    await supabase.from('Staff').insert({
        id: testStaffId,
        full_name: 'Nguyễn KTV Test',
        work_type: 'TYPE_B', // KTV Hợp tác
        status: 'ĐANG LÀM',
        phone: '0909090909'
    });

    console.log('✅ KTV đã được tạo thành công với work_type = TYPE_B');

    const date = new Date();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    // 3. Khởi tạo điểm đầu tháng (Sẽ là 100đ)
    console.log('\n🌟 Đang khởi tạo điểm tháng hiện tại cho KTV...');
    const pointsRecord = await KtvDisciplineService.initOrGetMonthlyPoints(supabase, testStaffId, month, year);
    console.log(`✅ Điểm hiện tại: ${pointsRecord.total_points}đ`);

    // 4. Kịch bản 1: Bị Quầy complain (-5đ)
    console.log('\n🚨 [Hành động] Lễ tân gửi Complain KTV...');
    const res1 = await KtvDisciplineService.deductPoints(supabase, testStaffId, 'RECEPTION_COMPLAINT', 'Khách phàn nàn thái độ');
    console.log(`📉 Điểm bị trừ: ${res1.penaltyPoints}đ. Điểm còn lại: ${res1.newTotal}đ`);
    await checkStaffType(testStaffId);

    await sleep(1000);

    // 5. Kịch bản 2: Từ chối đơn hàng (-10đ)
    console.log('\n🚨 [Hành động] KTV từ chối nhận đơn hàng...');
    const res2 = await KtvDisciplineService.deductPoints(supabase, testStaffId, 'ORDER_REJECT', 'Bận việc riêng');
    console.log(`📉 Điểm bị trừ: ${res2.penaltyPoints}đ. Điểm còn lại: ${res2.newTotal}đ`);
    await checkStaffType(testStaffId);

    await sleep(1000);

    // 6. Kịch bản 3: Lỗi bàn giao (-5đ)
    console.log('\n🚨 [Hành động] Lỗi bàn giao phòng không đạt...');
    const res3 = await KtvDisciplineService.deductPoints(supabase, testStaffId, 'HANDOVER_REJECT', 'Khăn chưa gấp gọn');
    console.log(`📉 Điểm bị trừ: ${res3.penaltyPoints}đ. Điểm còn lại: ${res3.newTotal}đ`);
    await checkStaffType(testStaffId);

    await sleep(1000);

    // 7. Kịch bản 4: Cú đấm quyết định - Từ chối thêm đơn hàng (-10đ) -> Sẽ rớt xuống 70đ (<80)
    console.log('\n🚨 [Hành động CHÍ MẠNG] KTV lại từ chối đơn hàng...');
    const res4 = await KtvDisciplineService.deductPoints(supabase, testStaffId, 'ORDER_REJECT', 'Mệt không muốn làm');
    console.log(`📉 Điểm bị trừ: ${res4.penaltyPoints}đ. Điểm còn lại: ${res4.newTotal}đ`);
    
    // Đợi 1 chút để DB update
    await sleep(1000);
    console.log('\n🔍 Kiểm tra kết quả sau khi điểm tụt xuống dưới 80:');
    await checkStaffType(testStaffId);

    console.log('\n✅ MÔ PHỎNG KẾT THÚC.');
}

async function checkStaffType(staffId: string) {
    const { data } = await supabase.from('Staff').select('work_type').eq('id', staffId).single();
    if (data) {
        if (data.work_type === 'TYPE_A') {
            console.log(`⚠️  CẢNH BÁO: KTV đã bị giáng chức thành TYPE_A!`);
        } else {
            console.log(`ℹ️  Trạng thái KTV vẫn an toàn: ${data.work_type}`);
        }
    }
}

runSimulation().catch(console.error);
