/**
 * Bật Ví Thu Nhập + Ví Điểm-theo-Office cho các TÀI KHOẢN TEST loại D.
 *
 * Chỉ ghi ĐÚNG ba khoá `tua_wallet`, `bonus_wallet`, `bonus_from_office`; mọi
 * khoá khác trong `feature_flags` giữ nguyên (`is_on_call`, `travel_time_mins`…
 * do màn khác ghi chung vào đây).
 *
 * Mặc định chạy KHÔ (in ra rồi thoát). Ghi thật thì thêm `--apply`.
 * Tắt lại thì thêm `--off`.
 *
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *     scripts/qa/enable_office_bonus_for_test_accounts.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APPLY = process.argv.includes('--apply');
const OFF = process.argv.includes('--off');

/**
 * Tài khoản test loại D. Mã `T###` là bộ tài khoản dựng để chạy thử
 * (scripts/seed_type_d_test_accounts.js); `NH###` là người thật.
 *
 * Người thật KHÔNG nằm trong danh sách này — đổi nguồn điểm của họ là đổi cách
 * tính quỹ nội bộ họ phải đóng, phải do quản lý bấm trên bảng Tính năng.
 */
const TEST_ID = /^T\d+$/i;

async function main() {
    const { data: staff } = await supabase
        .from('Staff').select('id, full_name, work_type, feature_flags, status')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id');

    const targets = (staff || []).filter(s => TEST_ID.test(s.id));
    const skipped = (staff || []).filter(s => !TEST_ID.test(s.id));

    console.log(`\nTai khoan test loai D: ${targets.length}`);
    console.log(`Bo qua (nguoi that)  : ${skipped.map(s => s.id).join(', ') || 'khong co'}`);
    console.log(`Che do               : ${OFF ? 'TAT' : 'BAT'} · ${APPLY ? 'GHI THAT' : 'CHAY KHO (them --apply de ghi)'}\n`);

    const rows: any[] = [];
    for (const s of targets) {
        const cur = (typeof s.feature_flags === 'string'
            ? JSON.parse(s.feature_flags || '{}')
            : (s.feature_flags || {})) as Record<string, any>;

        const next = {
            ...cur,
            tua_wallet: true,
            bonus_wallet: true,
            bonus_from_office: !OFF,
        };

        rows.push({
            id: s.id,
            ten: (s.full_name || '').slice(0, 20),
            truoc: `tua=${cur.tua_wallet ?? '-'} bonus=${cur.bonus_wallet ?? '-'} office=${cur.bonus_from_office ?? '-'}`,
            sau: `tua=${next.tua_wallet} bonus=${next.bonus_wallet} office=${next.bonus_from_office}`,
        });

        if (APPLY) {
            const { error } = await supabase
                .from('Staff').update({ feature_flags: next }).eq('id', s.id);
            if (error) console.error(`  LOI ${s.id}: ${error.message}`);
        }
    }

    console.table(rows);
    console.log(APPLY ? '\nDa ghi xong.\n' : '\nChua ghi gi. Them --apply de ghi that.\n');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
