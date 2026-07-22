const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixData() {
    const targetDate = '2026-04-30';
    console.log(`--- Fix data for ${targetDate} ---`);

    // 1. Lấy danh sách điểm danh
    const { data: attendance } = await supabase
        .from('KTVAttendance')
        .select('*')
        .gte('checkedAt', `${targetDate}T00:00:00Z`)
        .lte('checkedAt', `${targetDate}T23:59:59Z`);

    if (attendance) {
        console.log(`Processing ${attendance.length} attendance records...`);
        for (const att of attendance) {
            // Lấy staffCode
            const { data: user } = await supabase.from('Users').select('code').eq('id', att.employeeId).single();
            const code = user?.code || att.employeeId;
            const status = (att.checkType === 'SUDDEN_OFF' || att.checkType === 'CHECK_OUT') ? 'off' : 'waiting';

            console.log(`- Upserting ${code} as ${status}`);
            await supabase.from('TurnQueue').upsert({
                employee_id: code,
                date: targetDate,
                status: status
            }, { onConflict: 'employee_id,date' });
        }
    }

    // 2. Chạy Sync số tua từ Ledger
    console.log('Syncing turn counts from Ledger...');
    const { data: ledgers } = await supabase.from('TurnLedger').select('employee_id').eq('date', targetDate);
    const counts = {};
    ledgers.forEach(l => counts[l.employee_id] = (counts[l.employee_id] || 0) + 1);

    for (const [empId, count] of Object.entries(counts)) {
        console.log(`- ${empId}: ${count} turns`);
        await supabase.from('TurnQueue').upsert({
            employee_id: empId,
            date: targetDate,
            turns_completed: count
        }, { onConflict: 'employee_id,date' });
    }

    console.log('✅ Done!');
}

fixData();
