/**
 * Vá tên người thao tác trong `BookingItems.options.counterLog`.
 *
 * Các dòng ghi trước 09/09/2026 có `byName = null`, nên thẻ Kanban rơi về hiển
 * thị `by` — vốn là cuid của tài khoản văn phòng ('cmlxhhysl0000d76c7xvak9gs')
 * chứ không phải mã nhân viên. Script này tra bảng Users để điền lại username.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/backfill_counter_log_names.ts
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
let url = '', key = '';
envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = line.split('=')[1].trim();
});
const supabase = createClient(url, key);

async function main() {
    const { data: users } = await supabase.from('Users').select('id, username');
    const nameById: Record<string, string> = {};
    (users || []).forEach((u: any) => { if (u.id && u.username) nameById[u.id] = u.username; });
    console.log(`Đã nạp ${Object.keys(nameById).length} tài khoản.`);

    const { data: items, error } = await supabase
        .from('BookingItems')
        .select('id, options')
        .not('options', 'is', null);
    if (error) throw error;

    let itemsFixed = 0, rowsFixed = 0;
    for (const it of items || []) {
        let opts: any = (it as any).options;
        if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { continue; } }
        const log = opts?.counterLog;
        if (!Array.isArray(log) || log.length === 0) continue;

        let changed = false;
        for (const row of log) {
            if (row?.byName) continue;
            const name = row?.by ? nameById[row.by] : null;
            if (name) { row.byName = name; changed = true; rowsFixed++; }
        }
        if (!changed) continue;

        const { error: e } = await supabase.from('BookingItems').update({ options: opts }).eq('id', it.id);
        if (e) { console.error(`  ✗ ${it.id}: ${e.message}`); continue; }
        itemsFixed++;
    }
    console.log(`Xong: vá ${rowsFixed} dòng nhật ký trên ${itemsFixed} dịch vụ.`);
}

main().catch(e => { console.error(e); process.exit(1); });
