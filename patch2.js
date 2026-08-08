const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/reception/ktv-hub/page.tsx');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(/select\('employee_id'\)\.eq\('date'/g, "select('employeeId').eq('date'");
content = content.replace(/l\.employee_id\)/g, "l.employeeId || l.employee_id)");

fs.writeFileSync(p, content);
console.log("Patched ktv-hub/page.tsx");
