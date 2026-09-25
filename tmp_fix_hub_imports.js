const fs = require('fs');
const path = 'app/reception/ktv-hub/page.tsx';
let c = fs.readFileSync(path, 'utf8');

c = c.replace(/import \{([\s\S]*?)\} from 'lucide-react';/, (match, p1) => {
    return `import {${p1}, Trash2, CalendarDays, CalendarOff } from 'lucide-react';`;
});

fs.writeFileSync(path, c);
console.log('Imports fixed');
