const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanGarbage() {
    console.log('Cleaning garbage Ledger entries...');
    const { error: delError } = await supabase
        .from('TurnLedger')
        .delete()
        .eq('date', '2026-04-30')
        .eq('employee_id', 'Tom, NH027');
    
    if (delError) console.error(delError);
    else console.log('✅ Deleted "Tom, NH027" from Ledger.');

    // Đồng thời xóa các KTV không có mã chuẩn (không bắt đầu bằng NH hoặc mã số hợp lệ)
    // Nhưng cẩn thận với Lisa, Tom, T Tiên (có vẻ là tên thay cho mã)
    // Tôi sẽ chỉ xóa cái gộp dấu phẩy.
}

cleanGarbage();
