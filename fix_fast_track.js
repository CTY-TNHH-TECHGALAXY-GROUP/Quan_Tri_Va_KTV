const fs = require('fs');
const file = 'app/ktv/dashboard/KTVDashboard.logic.ts';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(/if \(screenRef\.current === 'HANDOVER'\) \{/, "if (screenRef.current === 'HANDOVER' || screenRef.current === 'REWARD') {");
c = c.replace(/\/\/ 1\. Auto-complete the current order in DB\r?\n\s+if \(bookingRef\.current\) \{/, "// 1. Auto-complete the current order in DB (only if from HANDOVER)\n                if (screenRef.current === 'HANDOVER' && bookingRef.current) {");
fs.writeFileSync(file, c);
console.log('Done');
