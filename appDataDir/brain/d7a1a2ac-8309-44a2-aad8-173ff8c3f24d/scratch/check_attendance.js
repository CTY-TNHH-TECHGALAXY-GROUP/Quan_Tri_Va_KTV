const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAttendance() {
    const { data: att } = await supabase.from('KTVAttendance').select('*').gte('checkedAt', '2026-04-30T00:00:00Z').lte('checkedAt', '2026-04-30T23:59:59Z');
    console.log(`Total Attendance Records for 30/4: ${att?.length || 0}`);
    if (att) att.forEach(a => console.log(`- ${a.employeeId}: type=${a.checkType}, status=${a.status}`));
}

checkAttendance();
