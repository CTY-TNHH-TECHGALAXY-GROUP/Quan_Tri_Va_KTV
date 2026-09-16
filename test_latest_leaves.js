const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const envConfig = {};
envFile.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
        let key = match[1];
        let value = match[2] || '';
        value = value.replace(/(^['"]|['"]$)/g, '').trim();
        envConfig[key] = value;
    }
});

const supabaseUrl = envConfig['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envConfig['SUPABASE_SERVICE_ROLE_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestLeaves() {
    console.log(`Đang kiểm tra bảng KTVLeaveRequests trên DB: ${supabaseUrl}`);
    const { data, error } = await supabase
        .from('KTVLeaveRequests')
        .select('employeeId, date, status, reason')
        .order('date', { ascending: false })
        .limit(10);
    
    if (error) {
        console.error('Lỗi:', error);
    } else {
        console.log('10 đăng ký nghỉ GẦN NHẤT trong Database này là:');
        console.table(data);
    }
}

checkLatestLeaves();
