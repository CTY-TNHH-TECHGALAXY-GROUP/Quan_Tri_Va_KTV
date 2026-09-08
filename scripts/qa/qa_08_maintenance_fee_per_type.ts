/**
 * QA #8 — Phí bảo trì: Loại D có cần gạt riêng, A/B/C giữ nguyên hành vi cũ.
 *
 * Bối cảnh: thẻ "Phí Bảo Trì Hệ Thống" nằm trong từng tab loại nên nó GHI khoá
 * có hậu tố (`enable_maintenance_fee_TYPE_A`…), còn cron thì đọc khoá KHÔNG hậu
 * tố — thẻ đó là nút giả. Đợt này CHỈ mở khoá riêng cho Loại D; A/B/C cố ý để
 * nguyên, xử lý sau. Vì vậy phần lớn các mục dưới đây là để CHỐT rằng A/B/C
 * không bị đổi hành vi ngoài ý muốn.
 *
 * Bốn nhóm kiểm tra:
 *   M1. Loại D: khoá `_TYPE_D` thắng khoá chung.
 *   M2. A/B/C: khoá `_TYPE_A/B/C` bị BỎ QUA, vẫn đọc khoá chung như cũ.
 *   M3. Giá trị jsonb dạng chuỗi (`"true"`, `'"false"'`) đọc vẫn đúng.
 *   M4. Chạy trên cấu hình THẬT trong DB: ai sẽ bị thu vào lần cron tới.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/qa/qa_08_maintenance_fee_per_type.ts
 * CHỈ ĐỌC DB — không ghi WalletAdjustments, không gọi cron.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolveMaintenanceFeeForType } from '../../lib/services/KtvLedgerSyncService';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

async function main() {
    // ── M1: Loại D — khoá riêng thắng khoá chung ───────────────────────
    console.log('\n--- M1: Loai D co can gat rieng ---');
    {
        // Chung BẬT nhưng Loại D tắt riêng -> D không bị thu.
        const cfg = { enable_maintenance_fee: true, maintenance_fee_amount: 50000, enable_maintenance_fee_TYPE_D: false };
        check(!resolveMaintenanceFeeForType(cfg, 'TYPE_D').enabled, 'Chung BAT + rieng TYPE_D TAT -> D khong thu');

        // Chiều ngược lại: chung TẮT nhưng D bật riêng -> chỉ D bị thu.
        const cfg2 = { enable_maintenance_fee: false, enable_maintenance_fee_TYPE_D: true };
        check(resolveMaintenanceFeeForType(cfg2, 'TYPE_D').enabled, 'Chung TAT + rieng TYPE_D BAT -> D co thu');

        // Số tiền cũng theo được.
        const cfg3 = { enable_maintenance_fee: true, maintenance_fee_amount: 50000, maintenance_fee_amount_TYPE_D: 30000 };
        check(resolveMaintenanceFeeForType(cfg3, 'TYPE_D').amount === 30000, 'So tien rieng TYPE_D = 30.000d');

        // Thiếu dòng riêng thì rơi về mức chung — đúng như hiện trạng DB.
        const cfg4 = { enable_maintenance_fee: true, maintenance_fee_amount: 70000 };
        const d = resolveMaintenanceFeeForType(cfg4, 'TYPE_D');
        check(d.enabled && d.amount === 70000, 'TYPE_D khong co dong rieng -> an theo muc chung');
    }

    // ── M2: A/B/C phải GIỮ NGUYÊN hành vi cũ ───────────────────────────
    console.log('\n--- M2: A/B/C bo qua khoa hau to, van doc khoa chung ---');
    {
        // Đúng hiện trạng DB: chung BẬT, ba dòng riêng TẮT (đặt 27/08/2026).
        // Đợt này CỐ Ý không đọc ba dòng đó — đọc vào là 13 KTV ngừng bị thu.
        const cfg = {
            enable_maintenance_fee: true,
            maintenance_fee_amount: 50000,
            enable_maintenance_fee_TYPE_A: false,
            enable_maintenance_fee_TYPE_B: false,
            enable_maintenance_fee_TYPE_C: false,
        };
        check(resolveMaintenanceFeeForType(cfg, 'TYPE_A').enabled, 'TYPE_A bo qua dong rieng -> van thu theo khoa chung');
        check(resolveMaintenanceFeeForType(cfg, 'TYPE_B').enabled, 'TYPE_B bo qua dong rieng -> van thu theo khoa chung');
        check(resolveMaintenanceFeeForType(cfg, 'TYPE_C').enabled, 'TYPE_C bo qua dong rieng -> van thu theo khoa chung');

        // Số tiền cũng vậy: dòng riêng của A/B/C không được ăn thua.
        const cfg2 = { enable_maintenance_fee: true, maintenance_fee_amount: 50000, maintenance_fee_amount_TYPE_A: 999000 };
        check(resolveMaintenanceFeeForType(cfg2, 'TYPE_A').amount === 50000, 'TYPE_A bo qua so tien rieng -> van 50.000d');

        // Không có gì trong DB thì mặc định TẮT — không tự ý trừ tiền người ta.
        const empty = resolveMaintenanceFeeForType({}, 'TYPE_A');
        check(!empty.enabled, 'Khong co cau hinh nao -> mac dinh TAT');
        check(empty.amount === 50000, 'Muc mac dinh van la 50.000d');
    }

    // ── M3: giá trị jsonb dạng chuỗi ───────────────────────────────────
    console.log('\n--- M3: gia tri jsonb dang chuoi doc van dung ---');
    {
        check(resolveMaintenanceFeeForType({ enable_maintenance_fee: 'true' }, 'TYPE_A').enabled,
            'Khoa chung, chuoi "true" -> BAT');
        check(!resolveMaintenanceFeeForType({ enable_maintenance_fee: '"false"' }, 'TYPE_A').enabled,
            'Khoa chung, chuoi co nhay \'"false"\' -> TAT');
        check(resolveMaintenanceFeeForType({ enable_maintenance_fee_TYPE_D: '"true"' }, 'TYPE_D').enabled,
            'Khoa TYPE_D, chuoi co nhay \'"true"\' -> BAT', 'so === true thang la doc nham thanh TAT');
        check(!resolveMaintenanceFeeForType({ enable_maintenance_fee: true, enable_maintenance_fee_TYPE_D: '"false"' }, 'TYPE_D').enabled,
            'Khoa TYPE_D dang chuoi van thang duoc khoa chung');
        check(resolveMaintenanceFeeForType({ enable_maintenance_fee: true, maintenance_fee_amount: '"40000"' }, 'TYPE_A').amount === 40000,
            'So tien dang chuoi co nhay -> 40.000d');
    }

    // ── M4: chạy trên cấu hình THẬT ────────────────────────────────────
    console.log('\n--- M4: cau hinh THAT trong DB — ai se bi thu ky toi ---');
    {
        const { data: configRows, error: cfgErr } = await supabase
            .from('SystemConfigs').select('key, value')
            .or('key.like.enable_maintenance_fee%,key.like.maintenance_fee_amount%');
        check(!cfgErr, 'Doc duoc cau hinh phi bao tri', cfgErr?.message);

        const configs: Record<string, any> = {};
        (configRows || []).forEach(r => { configs[r.key] = r.value; });
        console.log('   Khoa dang co:', Object.keys(configs).sort().join(', ') || '(khong co)');

        const { data: ktvs, error: ktvErr } = await supabase
            .from('Staff').select('id, work_type, feature_flags')
            .eq('status', 'ĐANG LÀM').ilike('id', 'NH%');
        check(!ktvErr, 'Doc duoc danh sach KTV dang lam', ktvErr?.message);

        const perType = new Map<string, { total: number; charged: number; amount: number; enabled: boolean }>();
        for (const k of ktvs || []) {
            const wt = k.work_type || 'TYPE_A';
            const fee = resolveMaintenanceFeeForType(configs, wt);
            if (!perType.has(wt)) perType.set(wt, { total: 0, charged: 0, amount: fee.amount, enabled: fee.enabled });
            const row = perType.get(wt)!;
            row.total++;
            const flagOff = k.feature_flags && (k.feature_flags as any).maintenance_fee === false;
            if (fee.enabled && !flagOff) row.charged++;
        }

        let grand = 0;
        for (const [wt, r] of [...perType.entries()].sort()) {
            console.log(`   ${wt}: ${r.total} KTV | can gat ${r.enabled ? 'BAT' : 'TAT'} | se thu ${r.charged} nguoi x ${r.amount.toLocaleString('vi-VN')}d`);
            grand += r.charged * r.amount;
        }
        console.log(`   => Tong ky toi: ${grand.toLocaleString('vi-VN')}d`);

        // Cần gạt trên trang cấu hình phải thực sự điều khiển được kết quả:
        // loại nào đang TẮT thì không được có ai bị thu.
        for (const [wt, r] of perType) {
            if (!r.enabled) {
                check(r.charged === 0, `${wt} dang TAT -> khong ai bi thu`,
                    r.charged > 0 ? `van con ${r.charged} nguoi bi thu` : '');
            }
        }
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
