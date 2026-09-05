/**
 * Mô phỏng KHÔ luồng gửi email xác nhận khi lễ tân bấm "Xác nhận đơn".
 *
 * Chạy lại đúng chuỗi quyết định của confirmWebBooking() trên dữ liệu THẬT,
 * nhưng KHÔNG gửi email và KHÔNG ghi bất cứ thứ gì xuống DB.
 *
 *   npx ts-node -O "{\"module\":\"commonjs\"}" scripts/simulate_booking_email.ts
 *
 * Thêm --html để ghi ra file HTML của email đầu tiên gửi được, để xem bằng mắt.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { isDummyEmail } from '../lib/customer.logic';
import { formatBodyAreas, normalizeStrength } from '../lib/booking.logic';
import { getEmailConfig } from '../lib/email-config';
import { renderBookingEmailHtml, getBookingEmailSubject, buildVietQrUrl, BookingDetails } from '../lib/email';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WRITE_HTML = process.argv.includes('--html');
const LIMIT = 12;

type Ket = 'GUI' | 'BO_QUA';

async function main() {
    console.log('═'.repeat(78));
    console.log('MÔ PHỎNG KHÔ — luồng email xác nhận đơn (không gửi mail, không ghi DB)');
    console.log('═'.repeat(78));

    // ── 1. Công tắc hệ thống ────────────────────────────────────────────────
    const cfg = await getEmailConfig();
    const congTac = cfg.enable_web_advance_booking_email;
    console.log(`\n[1] Công tắc gửi email          : ${congTac ? 'BẬT' : 'TẮT'}`);
    console.log(`    Thương hiệu                 : ${cfg.email_brand_name}`);
    console.log(`    Hotline                     : ${cfg.email_hotline}`);
    console.log(`    Tài khoản nhận cọc          : ${cfg.email_bank_bin} / ${cfg.email_bank_account_no}`);
    if (!congTac) {
        console.log('    ⚠️  Công tắc đang TẮT → thực tế sẽ KHÔNG đơn nào được gửi.');
        console.log('        Bên dưới vẫn mô phỏng tiếp để kiểm tra các bước còn lại.');
    }

    // ── 2. Lấy đơn thật ─────────────────────────────────────────────────────
    const { data: rows, error } = await supabase
        .from('Bookings')
        .select(`
            id, billCode, customerName, customerEmail, customerLang, customerPhone,
            bookingDate, timeBooking, totalAmount, technicianCode, notes,
            BookingItems!BookingItems_bookingId_fkey (
                quantity, serviceId, options,
                Services!BookingItems_serviceId_fkey ( nameVN, nameEN, nameKR, nameJP, nameCN, duration )
            )
        `)
        .not('customerEmail', 'is', null)
        .order('bookingDate', { ascending: false })
        .limit(LIMIT);

    if (error) throw new Error(error.message);
    if (!rows?.length) { console.log('\nKhông có đơn nào để mô phỏng.'); return; }

    console.log(`\n[2] Lấy ${rows.length} đơn gần nhất có email\n`);
    console.log('    ' + 'MÃ ĐƠN'.padEnd(20) + 'EMAIL'.padEnd(34) + 'NGÔN NGỮ  KẾT QUẢ');
    console.log('    ' + '─'.repeat(72));

    let soGui = 0, soBoQua = 0;
    let mauDauTien: { html: string; subject: string; billCode: string } | null = null;

    for (const b of rows as any[]) {
        // ── Quyết định gửi hay không: y hệt confirmWebBooking ──
        const emailAo = isDummyEmail(b.customerEmail || '');
        const ketQua: Ket = (b.customerEmail && !emailAo && congTac) ? 'GUI' : 'BO_QUA';

        let lyDo = '';
        if (ketQua === 'BO_QUA') {
            if (!congTac) lyDo = 'công tắc TẮT';
            else if (emailAo) lyDo = 'email ảo';
            else lyDo = 'không có email';
        }

        const lang = b.customerLang || 'vi';
        console.log(
            '    ' + String(b.billCode || b.id).slice(0, 19).padEnd(20)
            + String(b.customerEmail).slice(0, 33).padEnd(34)
            + String(lang).padEnd(10)
            + (ketQua === 'GUI' ? '✓ GỬI' : `✗ bỏ qua (${lyDo})`)
        );

        if (ketQua !== 'GUI') { soBoQua++; continue; }
        soGui++;

        // ── Dựng bookingDetails: y hệt confirmWebBooking ──
        let tongPhut = 0, tongKhach = 0;
        const dichVu: { name: string; duration: number }[] = [];
        const focus = new Set<string>(), avoid = new Set<string>(), luc = new Set<string>();
        const ghiChuItem: string[] = [];

        for (const it of (b.BookingItems || [])) {
            tongKhach += it.quantity || 1;
            let opts: any = it.options ?? {};
            if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
            const f = formatBodyAreas(opts.focus), a = formatBodyAreas(opts.avoid);
            if (f) focus.add(f);
            if (a) avoid.add(a);
            if (opts.strength) luc.add(normalizeStrength(opts.strength));
            const n = opts.note || opts.customerNotes;
            if (n) ghiChuItem.push(String(n).trim());

            if (it.Services) {
                tongPhut += it.Services.duration || 0;
                let ten = it.Services.nameEN || 'Service';
                if (lang === 'vi') ten = it.Services.nameVN || ten;
                else if (lang === 'kr') ten = it.Services.nameKR || ten;
                else if (lang === 'jp') ten = it.Services.nameJP || ten;
                else if (lang === 'cn') ten = it.Services.nameCN || ten;
                dichVu.push({ name: ten, duration: it.Services.duration || 0 });
            }
        }

        let ghiChu = '';
        if (typeof b.notes === 'string' && b.notes.trim()) {
            const raw = b.notes.trim();
            if (raw.startsWith('{')) {
                try { const p = JSON.parse(raw); ghiChu = p.customerNote || p.note || ''; } catch { ghiChu = ''; }
            } else ghiChu = raw;
        }

        const details: BookingDetails = {
            bookingId: b.billCode || b.id,
            date: b.bookingDate || '',
            time: b.timeBooking || '',
            services: dichVu,
            duration: tongPhut,
            guests: tongKhach,
            depositAmount: b.totalAmount ? Math.max(100000, Math.round((b.totalAmount * 0.5) / 100000) * 100000) : 0,
            totalAmount: b.totalAmount || 0,
            therapist: (b.technicianCode || '').trim(),
            preferences: {
                focus: [...focus].join(', '),
                avoid: [...avoid].join(', '),
                strength: [...luc].join(', '),
            },
            note: [ghiChu, ...ghiChuItem].filter(Boolean).join('\n'),
        };

        // ── Dựng email thật (chỉ dựng, không gửi) ──
        const html = renderBookingEmailHtml(
            cfg, b.customerName || 'Quý khách', lang, false, details,
            'cid:international-qr', buildVietQrUrl(cfg, details.depositAmount, details.bookingId)
        );
        const subject = getBookingEmailSubject(cfg, lang, details.bookingId);

        // Kiểm tra bất biến của nội dung email
        const loi: string[] = [];
        if (!html.includes(cfg.email_brand_name)) loi.push('thiếu tên thương hiệu');
        if (!html.includes(String(details.bookingId))) loi.push('thiếu mã đơn');
        if (html.includes('XÁC NHẬN GIỮ CHỖ') || html.includes('vietqr.io')) loi.push('KHỐI ĐẶT CỌC CHƯA BỊ GỠ');
        if (html.includes('undefined') || html.includes('NaN')) loi.push('có undefined/NaN');
        if (loi.length) console.log(`        ⚠️  ${loi.join(' | ')}`);

        if (!mauDauTien) mauDauTien = { html, subject, billCode: String(details.bookingId) };
    }

    // ── 3. Tổng kết ─────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(78));
    console.log(`[3] Kết quả: ${soGui} đơn sẽ gửi email, ${soBoQua} đơn bỏ qua`);

    if (mauDauTien) {
        console.log(`\n[4] Email mẫu dựng từ đơn thật ${mauDauTien.billCode}`);
        console.log(`    Tiêu đề : ${mauDauTien.subject}`);
        console.log(`    Kích cỡ : ${mauDauTien.html.length} ký tự`);
        if (WRITE_HTML) {
            const f = 'scripts/_simulate_email_output.html';
            fs.writeFileSync(f, mauDauTien.html, 'utf8');
            console.log(`    Đã ghi  : ${f}`);
        }
    }

    console.log('\n✅ Mô phỏng xong. KHÔNG gửi email nào, KHÔNG ghi DB.');
}

main().catch(e => { console.error('❌ Lỗi mô phỏng:', e.message); process.exit(1); });
