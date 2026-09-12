const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAttendanceReset() {
    const yesterday = '2026-04-30';
    const today = '2026-05-01';
    const targetKTVs = ['NH002', 'NH025'];

    console.log(`--- Attendance Check for ${yesterday} ---`);
    const { data: attendance } = await supabase
        .from('KTVAttendance')
        .select('*')
        .in('employee_id', targetKTVs)
        .eq('date', yesterday);
    
    attendance?.forEach(a => {
        console.log(`- ${a.employee_id}: type=${a.type}, time=${a.check_in_time || a.check_out_time}, status=${a.status}`);
    });

    console.log(`\n--- TurnQueue for ${today} ---`);
    const { data: queueToday } = await supabase
        .from('TurnQueue')
        .select('*')
        .eq('date', today);
    
    console.log(`Found ${queueToday?.length || 0} KTVs in queue for today.`);
    queueToday?.forEach(q => {
        console.log(`- ${q.employee_id}: status=${q.status}, turns=${q.turns_completed}`);
    });

    console.log(`\n--- TurnQueue for ${yesterday} (checking current status) ---`);
    const { data: queueYesterday } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', targetKTVs)
        .eq('date', yesterday);
    
    queueYesterday?.forEach(q => {
        console.log(`- ${q.employee_id}: status=${q.status}, turns=${q.turns_completed}`);
    });
}

checkAttendanceReset();
