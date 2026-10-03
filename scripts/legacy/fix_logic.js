const fs = require('fs');
const file = 'app/ktv/dashboard/KTVDashboard.logic.ts';
let lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

// 1. Add import
const importIdx = lines.findIndex(l => l.includes("import { supabase } from '@/lib/supabase';"));
if (importIdx !== -1) {
    lines.splice(importIdx + 1, 0, "import { useNotifications } from '@/components/NotificationProvider';");
}

// 2. Add setKtvScreen
const hookIdx = lines.findIndex(l => l.includes("const ktvId = config?.testTechCode || user?.id;"));
if (hookIdx !== -1) {
    lines.splice(hookIdx, 0, "    const { setKtvScreen } = useNotifications();");
}

// 3. Add to setScreen
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("try { localStorage.setItem('ktv_active_screen', val); } catch(e) {}")) {
        lines.splice(i, 0, "        setKtvScreen(val);");
        break;
    }
}

// 4. Update useCallback deps
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("}, []);") && lines[i-1].includes("ktv_active_screen")) {
        lines[i] = lines[i].replace("}, []);", "}, [setKtvScreen]);");
        break;
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log("Done");
