const fs = require('fs');
const content = fs.readFileSync('supabase/migrations/20260814170000_add_sub_booking_support.sql', 'utf8');

const startIdx = content.indexOf('CREATE OR REPLACE FUNCTION dispatch_confirm_booking');
const endIdx = content.indexOf('$$;', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    let func = content.substring(startIdx, endIdx + 3);
    
    // add DECLARE for v_ledger_booking_id
    func = func.replace('DECLARE', 'DECLARE\n    v_ledger_booking_id text;');
    
    // Use regex to replace the TurnLedger block
    const regex = /BEGIN\s+INSERT INTO "TurnLedger" \("date", "booking_id", "employee_id", "source"\)\s+VALUES \(p_date, p_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM'\)\s+ON CONFLICT \("date", "booking_id", "employee_id"\) DO NOTHING;\s+EXCEPTION WHEN OTHERS THEN/g;

    const newInsert = `BEGIN
            SELECT COALESCE(parent_booking_id, id) INTO v_ledger_booking_id
            FROM "Bookings"
            WHERE id = p_booking_id;

            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, v_ledger_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
            ON CONFLICT ("date", "booking_id", "employee_id") DO NOTHING;
        EXCEPTION WHEN OTHERS THEN`;

    if (regex.test(func)) {
        func = func.replace(regex, newInsert);
        fs.writeFileSync('supabase/migrations/20260816221146_fix_turnledger_parent_booking_id.sql', func + '\n');
        console.log('Done!');
    } else {
        console.log('Regex did not match.');
    }
} else {
    console.log('Failed to match boundaries.');
}
