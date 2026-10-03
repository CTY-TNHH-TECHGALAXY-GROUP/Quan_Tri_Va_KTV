const fs = require('fs');
const path = 'app/api/ktv/booking/route.ts';
let code = fs.readFileSync(path, 'utf8');

const t1_unix = `                if (!turn || !turn.current_order_id) {\n                    return NextResponse.json({ success: true, data: null });\n                }`;
const t1_win = `                if (!turn || !turn.current_order_id) {\r\n                    return NextResponse.json({ success: true, data: null });\r\n                }`;

const r1_unix = `                if (!turn || !turn.current_order_id) {\n                    const { data: nextAssign } = await supabase.from('KtvAssignments').select('booking_id').eq('employee_id', technicianCode).eq('business_date', today).in('status', ['QUEUED', 'READY']).order('priority', { ascending: true }).order('planned_start_time', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();\n                    if (nextAssign) return NextResponse.json({ success: true, data: { nextBookingId: nextAssign.booking_id } });\n                    return NextResponse.json({ success: true, data: null });\n                }`;
const r1_win = r1_unix.replace(/\n/g, '\r\n');

const t2_unix = `        if (!booking) {\n            return NextResponse.json({ success: true, data: null });\n        }`;
const t2_win = `        if (!booking) {\r\n            return NextResponse.json({ success: true, data: null });\r\n        }`;

const r2_unix = `        if (!booking) {\n            if (technicianCode) {\n                const today = getBusinessDate();\n                const { data: nextAssign } = await supabase.from('KtvAssignments').select('booking_id').eq('employee_id', technicianCode).eq('business_date', today).in('status', ['QUEUED', 'READY']).order('priority', { ascending: true }).order('planned_start_time', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();\n                if (nextAssign) return NextResponse.json({ success: true, data: { nextBookingId: nextAssign.booking_id } });\n            }\n            return NextResponse.json({ success: true, data: null });\n        }`;
const r2_win = r2_unix.replace(/\n/g, '\r\n');

code = code.replace(t1_unix, r1_unix).replace(t1_win, r1_win);
code = code.replace(t2_unix, r2_unix).replace(t2_win, r2_win);

fs.writeFileSync(path, code);
console.log("Updated");
