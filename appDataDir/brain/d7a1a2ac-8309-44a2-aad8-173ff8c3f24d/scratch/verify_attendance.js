const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyAttendanceAudit() {
    const targetCodes = ['NH002', 'NH025'];
    console.log(`--- Verifying Attendance for ${targetCodes.join(', ')} ---`);

    // 1. Get UUIDs for these codes from Users table
    const { data: users } = await supabase
        .from('Users')
        .select('id, code, fullName')
        .in('code', targetCodes);

    if (!users || users.length === 0) {
        console.log('No users found with these codes.');
        return;
    }

    const userIds = users.map(u => u.id);
    const codeMap = Object.fromEntries(users.map(u => [u.id, u.code]));

    // 2. Query Attendance for these UUIDs
    const { data: attendance } = await supabase
        .from('KTVAttendance')
        .select('*')
        .in('employeeId', userIds)
        .gte('checkedAt', '2026-04-30T00:00:00')
        .order('checkedAt', { ascending: false });

    console.log(`Found ${attendance?.length || 0} attendance records since 30/04.`);
    attendance?.forEach(a => {
        console.log(`- Code: ${codeMap[a.employeeId]}, Type: ${a.checkType}, Status: ${a.status}, Time: ${a.checkedAt}`);
    });

    // 3. Check TurnQueue status for today (01/05)
    console.log('\n--- TurnQueue Status Today (01/05) ---');
    const { data: queue } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', targetCodes)
        .eq('date', '2026-05-01');

    if (!queue || queue.length === 0) {
        console.log('No one in queue for 01/05 yet.');
    } else {
        queue.forEach(q => {
            console.log(`- ${q.employee_id}: status=${q.status}, turns=${q.turns_completed}`);
        });
    }
}

verifyAttendanceAudit();
