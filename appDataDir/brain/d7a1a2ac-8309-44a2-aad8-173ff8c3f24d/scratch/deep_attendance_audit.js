const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function deepAuditAttendance() {
    const targetKTVs = ['NH002', 'NH025'];
    console.log('--- Deep Audit for NH002 and NH025 ---');

    // Get all records for these KTVs to see history
    const { data: records, error } = await supabase
        .from('KTVAttendance')
        .select('*')
        .in('employee_id', targetKTVs)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error(error);
        return;
    }

    if (!records || records.length === 0) {
        console.log('No attendance records found at all for these IDs.');
    } else {
        records.forEach(r => {
            console.log(`- ID: ${r.employee_id}, Date: ${r.date}, Type: ${r.type}, Status: ${r.status}, CreatedAt: ${r.created_at}`);
        });
    }

    // Also check TurnQueue status
    console.log('\n--- Current TurnQueue (30/04 and 01/05) ---');
    const { data: queue } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', targetKTVs)
        .in('date', ['2026-04-30', '2026-05-01']);
    
    queue?.forEach(q => {
        console.log(`- ${q.employee_id}, Date: ${q.date}, Status: ${q.status}`);
    });
}

deepAuditAttendance();
