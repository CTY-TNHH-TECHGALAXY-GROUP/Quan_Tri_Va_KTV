/**
 * QA #17 — Trang Thu Ngân KTV phải hiện ĐỦ loại D và số phải KHỚP ví KTV.
 *
 * Bối cảnh: `/api/finance/ktv-summary` và `/api/finance/ktv-bonus-summary` lọc
 * nhân viên bằng `ilike('id','NH%')`, trong khi KTV loại D mang mã `T001`,
 * `T016`… nên không có dòng nào trên bảng thu ngân — dù lệnh rút tiền của họ
 * vẫn nhảy lên khối "chờ ra quầy lấy tiền".
 *
 * Bỏ bộ lọc mã KHÔNG đủ: nhánh tính tiền cũ quét lại `Bookings` bằng
 * `KtvCommissionService`, vốn không biết `rate_per_60m` / trừ sao / thuế của
 * loại D, và `getAllConfigs` không có `TYPE_D` nên rơi về tiền cọc loại A.
 * Nên loại D được đọc thẳng sổ cái tua qua `KtvTypeDWalletService`.
 *
 * Kịch bản kiểm (CLAUDE.md 4.3 — đối chiếu 2 phía):
 *   1. Bộ lọc mới (KtvRosterService) so với `ilike 'NH%'` — ai được thêm vào,
 *      có đúng là KTV không, có bắt đủ loại D không.
 *   2. Với MỌI KTV loại D: số ở phía Quầy (`getFinanceSummaries`, không lọc
 *      ngày) phải BẰNG số ở phía KTV (`KtvWalletService.getBalance`).
 *   3. Bộ lọc ngày chỉ được đổi cột "trong kỳ"; số dư phải giữ nguyên ALL TIME.
 *   4. Cột trong kỳ cộng lại (kỳ trước + trong kỳ) phải ra đúng tổng all-time.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_17_finance_type_d_parity.ts
 * Chạy thêm dưới TZ=UTC (CLAUDE.md 13.6) — server thật chạy UTC.
 * CHỈ ĐỌC — không ghi gì vào DB.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvRosterService } from '../../lib/services/KtvRosterService';
import { KtvTypeDWalletService } from '../../lib/services/KtvTypeDWalletService';
import { KtvWalletService } from '../../lib/services/KtvWalletService';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
    if (!ok) failures++;
    console.log(`${ok ? '  [DAT]' : '  [HONG]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const vnd = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'd';
const r0 = (n: number) => Math.round(Number(n) || 0);

async function main() {
    console.log(`\n===== QA #17 — Thu Ngan KTV x Loai D (TZ=${process.env.TZ || 'he thong'}) =====\n`);

    // ── 1. Bộ lọc nhân viên ────────────────────────────────────────────────
    console.log('--- 1. Bo loc nhan vien: KtvRosterService vs ilike NH% ---');
    const roster = await KtvRosterService.getActiveKtvs(supabase);
    const cu = roster.filter(k => /^NH/i.test(k.id));
    const themVao = roster.filter(k => !/^NH/i.test(k.id));

    console.log(`  Bo loc cu (NH%): ${cu.length} KTV`);
    console.log(`  Bo loc moi     : ${roster.length} KTV (+${themVao.length})`);
    console.log('  Duoc them vao  :');
    for (const k of themVao) {
        console.log(`    · ${k.id.padEnd(8)} ${String(k.full_name).padEnd(24)} ${k.work_type}`);
    }

    // ⚠️ Chốt chặn quan trọng nhất của bước này: sửa để THÊM loại D thì không
    // được làm MẤT ai đang có mặt. Bản nháp đầu dùng allowlist vai trò
    // `TECHNICIAN` và đã âm thầm xoá NH099 (Daisy, vai trò `SUPPORT`).
    const { data: theoLocCu } = await supabase
        .from('Staff').select('id, full_name')
        .eq('status', 'ĐANG LÀM').ilike('id', 'NH%');
    const moiIds = new Set(roster.map(k => k.id));
    const biMat = (theoLocCu || []).filter((s: any) => !moiIds.has(s.id));
    check(biMat.length === 0,
        `Khong ai bien mat so voi bo loc cu (${(theoLocCu || []).length} -> ${roster.length} dong)`,
        biMat.map((s: any) => `${s.id} ${s.full_name}`).join(', '));

    const dIds = roster.filter(k => k.work_type === 'TYPE_D').map(k => k.id);
    const dBiChanTruoc = roster.filter(k => k.work_type === 'TYPE_D' && !/^NH/i.test(k.id));
    check(dIds.length > 0, `Tim thay ${dIds.length} KTV loai D trong danh sach moi`);
    check(dBiChanTruoc.length > 0,
        `${dBiChanTruoc.length}/${dIds.length} KTV loai D truoc day BI CHAN khoi bang thu ngan`,
        dBiChanTruoc.map(k => k.id).join(', '));

    // Không được kéo nhầm người không phải KTV vào bảng tiền.
    const hopLe = new Set(['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D']);
    const laLoai = roster.filter(k => !hopLe.has(k.work_type));
    check(laLoai.length === 0, 'Moi dong deu co work_type hop le',
        laLoai.map(k => `${k.id}=${k.work_type}`).join(', '));
    const placeholder = roster.filter(k => /^(EXT|C_)/i.test(k.id));
    check(placeholder.length === 0, 'Khong co ma placeholder EXT.../C_... lot vao',
        placeholder.map(k => k.id).join(', '));

    if (dIds.length === 0) {
        console.log('\n(!) Khong co KTV loai D nao — dung o buoc 1.');
        console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
        return finish(failures);
    }

    // ── 2. Đối chiếu 2 phía ────────────────────────────────────────────────
    console.log('\n--- 2. Doi chieu 2 phia: Vi KTV vs Bang thu ngan (khong loc ngay) ---');
    const quay = await KtvTypeDWalletService.getFinanceSummaries(supabase, dIds, null, null);

    console.log(
        '  ' + 'MA'.padEnd(8) + 'CHI TIEU'.padEnd(20) +
        'PHIA KTV'.padStart(16) + 'PHIA QUAY'.padStart(16) + '  KET LUAN'
    );

    for (const id of dIds) {
        const ktv: any = await KtvWalletService.getBalance(supabase, id);
        const q: any = quay[id];
        if (!q) { check(false, `${id}: khong co dong nao ben Quay`); continue; }

        const capSoSanh: [string, number, number][] = [
            ['Tien tua (thuc nhan)', ktv.total_commission, q.total_commission],
            ['Tien tip', ktv.total_tip, q.total_tip],
            ['Thuong/Phat (dieu chinh)', ktv.total_adjustment, q.total_adjustment],
            ['Da rut', ktv.total_withdrawn, q.total_withdrawn],
            ['Cho duyet', ktv.total_pending, q.total_pending],
            ['Tong phat sinh', ktv.gross_income, q.gross_income],
            ['Tien coc', ktv.min_deposit, q.min_deposit],
            ['So du rong', ktv.net_balance, q.net_balance],
            ['Tien kha dung', ktv.available_balance, q.available_balance],
        ];

        let lech = 0;
        for (const [ten, a, b] of capSoSanh) {
            const ok = r0(a) === r0(b);
            if (!ok) lech++;
            console.log(
                '  ' + id.padEnd(8) + ten.padEnd(20) +
                vnd(a).padStart(16) + vnd(b).padStart(16) + (ok ? '  khop' : '  >>> LECH')
            );
        }
        check(lech === 0, `${id}: 9/9 chi tieu khop giua vi KTV va bang thu ngan`,
            lech ? `${lech} chi tieu lech` : '');
    }

    // ── 3. Bộ lọc ngày không được đổi số dư ────────────────────────────────
    console.log('\n--- 3. Bo loc ngay chi doi cot "trong ky", KHONG doi so du ---');
    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    const homNay = new Date(Date.now() + VN_OFFSET_MS).toISOString().split('T')[0];
    const theoNgay = await KtvTypeDWalletService.getFinanceSummaries(supabase, dIds, homNay, homNay);

    let soDuDoi = 0;
    for (const id of dIds) {
        const a = quay[id], b = theoNgay[id];
        if (r0(a.net_balance) !== r0(b.net_balance) ||
            r0(a.available_balance) !== r0(b.available_balance)) {
            soDuDoi++;
            console.log(`    ${id}: so du ${vnd(a.net_balance)} -> ${vnd(b.net_balance)}`);
        }
    }
    check(soDuDoi === 0, `Chon "Hom nay" (${homNay}) khong lam doi so du cua ${dIds.length} KTV loai D`);

    const coCotKy = dIds.some(id => r0(theoNgay[id].total_commission) !== r0(quay[id].total_commission));
    check(coCotKy || dIds.every(id => r0(quay[id].total_commission) === 0),
        'Cot "trong ky" thuc su doi theo bo loc ngay (khong phai bo loc chet)');

    // ── 4. Kỳ trước + trong kỳ = tổng all-time ─────────────────────────────
    console.log('\n--- 4. So du ky truoc + phat sinh trong ky = tong all-time ---');
    let congKhongKhop = 0;
    for (const id of dIds) {
        const all = quay[id];        // khong loc ngay => "trong ky" = all-time
        const ky = theoNgay[id];     // loc 1 ngay
        // (ky truoc + trong ky) phai bang tong all-time, tru phan rut cua ky truoc
        // da nam trong previous_balance.
        const tongGhepGross = r0(ky.previous_balance + ky.gross_income - ky.total_withdrawn);
        const tongAllGross = r0(all.gross_income - all.total_withdrawn);
        const ok = tongGhepGross === tongAllGross;
        if (!ok) {
            congKhongKhop++;
            console.log(`    ${id}: ghep ${vnd(tongGhepGross)} vs all-time ${vnd(tongAllGross)}`);
        }
    }
    check(congKhongKhop === 0, `Cong ky truoc + trong ky ra dung tong all-time cho ${dIds.length} KTV`);

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
