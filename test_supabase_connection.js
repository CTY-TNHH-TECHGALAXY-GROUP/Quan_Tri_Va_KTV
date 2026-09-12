const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Simple parse for .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
const envConfig = {};
envFile.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
        let key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
            value = value.replace(/\\n/gm, '\n');
        }
        value = value.replace(/(^['"]|['"]$)/g, '').trim();
        envConfig[key] = value;
    }
});

const supabaseUrl = envConfig['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envConfig['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function testLeaveData() {
    console.log('Đang kiểm tra lịch nghỉ của NH002 vào ngày mai (2026-06-18)...');
    
    // Fetch data từ bảng KTVLeaveRequests
    const { data, error } = await supabase
        .from('KTVLeaveRequests')
        .select('*')
        .eq('employeeId', 'NH002')
        .eq('date', '2026-06-18');
    
    if (error) {
        console.error('❌ Lỗi khi đọc dữ liệu:', error);
    } else {
        console.log('✅ Đọc dữ liệu thành công!');
        if (data.length > 0) {
            console.log(`Tìm thấy ${data.length} dòng đăng ký nghỉ cho NH002 vào ngày 2026-06-18:`);
            console.table(data.map(item => ({
                id: item.id,
                employeeId: item.employeeId,
                date: item.date,
                status: item.status,
                reason: item.reason
            })));
        } else {
            console.log('Không tìm thấy đăng ký nghỉ nào của NH002 vào ngày 2026-06-18.');
            
            // Tìm thử NH002 có nghỉ ngày nào không
            const { data: allLeaves } = await supabase
                .from('KTVLeaveRequests')
                .select('date, status')
                .eq('employeeId', 'NH002');
                
            if (allLeaves && allLeaves.length > 0) {
                 console.log(`NH002 có đăng ký nghỉ vào các ngày khác:`, allLeaves.map(l => l.date).join(', '));
            } else {
                 console.log('NH002 chưa từng đăng ký nghỉ ngày nào.');
            }
        }
    }
}

testLeaveData();
