import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import * as xlsx from 'xlsx';

export const dynamic = 'force-dynamic';

// 🔧 CONFIGURATION
const LANG_MAP: Record<string, string> = { en: 'English', vi: 'Tieng Viet', jp: 'Japanese', cn: 'Chinese', kr: 'Korean' };
const GENDER_DISPLAY: Record<string, string> = { male: 'Nam', female: 'Nu' };

/** Bypass Supabase 1000-row limit */
async function fetchAll(supabase: any, tableName: string, selectStr: string, buildQuery: (q: any) => any = (q) => q) {
    let allData: any[] = [];
    let from = 0;
    const limit = 1000;
    while (true) {
        let query = supabase.from(tableName).select(selectStr).range(from, from + limit - 1);
        query = buildQuery(query);
        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < limit) break;
        from += limit;
    }
    return allData;
}

/** Escape a value for CSV */
function csvEscape(v: any): string {
    const s = String(v == null ? '' : v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const fromDate = searchParams.get('from'); // e.g. '2026-07-06'
        const toDate = searchParams.get('to');     // e.g. '2026-07-08'
        const hasDateFilter = fromDate && toDate;

        // 1. Fetch customers
        const customers = await fetchAll(supabase, 'Customers', '*', q => q.order('fullName', { ascending: true }));

        // 2. Fetch bookings (with optional date filter)
        const allBookings = await fetchAll(supabase, 'Bookings',
            'id, customerId, customerName, customerEmail, customerLang, status, bookingDate, totalAmount, createdAt, notes, source, guestCount, BookingItems!fk_bookingitems_booking(id, serviceId, technicianCodes, options)',
            q => {
                let query = q.in('status', ['COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING']);
                if (hasDateFilter) {
                    query = query.gte('bookingDate', fromDate).lte('bookingDate', `${toDate}T23:59:59`);
                }
                return query;
            }
        );

        // 3. Fetch Services and Staff for mapping
        const [{ data: services }, { data: staff }] = await Promise.all([
            supabase.from('Services').select('id, nameVN, duration'),
            supabase.from('Staff').select('code, name')
        ]);
        const svcMap = new Map((services || []).map((s: any) => [s.id, { name: s.nameVN || '?', dur: s.duration || 0 }]));
        const stfMap = new Map((staff || []).map((s: any) => [s.code, s.name || '?']));

        // 4. Group bookings by customerId
        const byCid = new Map<string, any[]>();
        allBookings.forEach((b: any) => {
            if (b.customerId) {
                if (!byCid.has(b.customerId)) byCid.set(b.customerId, []);
                byCid.get(b.customerId)!.push(b);
            }
        });

        // 5. VN timezone formatter
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false });

        // 6. Build rows
        const rows: string[][] = [];
        const dateLabel = hasDateFilter ? `${fromDate} - ${toDate}` : 'Toan bo';

        for (const [cid, bookings] of byCid.entries()) {
            const cust = customers.find((c: any) => c.id === cid);
            if (!cust) continue;

            // Name-match filter: only keep bookings where customerName matches customer.fullName
            const cn = (cust.fullName || '').toLowerCase().trim();
            const filtered = bookings.filter((b: any) => {
                const bn = (b.customerName || '').toLowerCase().trim();
                return !bn || !cn || bn === cn || bn.includes(cn) || cn.includes(bn);
            });
            if (filtered.length === 0) continue;

            // Compute metrics
            let vip = 0;
            const strC: Record<string, number> = {};
            const lnC: Record<string, number> = {};
            const svcC: Record<string, number> = {};
            const ktvC: Record<string, number> = {};
            const tfC: Record<string, number> = {};

            filtered.forEach((b: any) => {
                if (b.source && b.source.toUpperCase().includes('VIP')) vip++;
                if (b.customerLang) {
                    const l = b.customerLang.toLowerCase().trim();
                    if (l) lnC[l] = (lnC[l] || 0) + 1;
                }
                // Time frame (use createdAt for walk-in midnight bookingDate)
                const raw = b.bookingDate || '';
                const isMid = raw.includes('T00:00:00') || /^\d{4}-\d{2}-\d{2}$/.test(raw);
                const src = isMid && b.createdAt ? b.createdAt : raw;
                const safe = src ? (src.endsWith('Z') ? src : src + 'Z') : '';
                if (safe) {
                    const d = new Date(safe);
                    if (!isNaN(d.getTime())) {
                        const h = parseInt(fmt.format(d), 10);
                        tfC[`${h}h-${h + 1}h`] = (tfC[`${h}h-${h + 1}h`] || 0) + 1;
                    }
                }
                if (b.BookingItems && Array.isArray(b.BookingItems)) {
                    b.BookingItems.forEach((item: any) => {
                        if (item.serviceId && item.serviceId !== 'NHS0900') svcC[item.serviceId] = (svcC[item.serviceId] || 0) + 1;
                        if (item.technicianCodes) {
                            item.technicianCodes.forEach((c: string) => { ktvC[c] = (ktvC[c] || 0) + 1; });
                        }
                        if (item.options && item.options.strength) {
                            const rawStr = item.options.strength.trim();
                            if (rawStr) {
                                const val = rawStr.toLowerCase();
                                const mapped = val === 'medium' || val === 'vừa' ? 'Vừa'
                                             : val === 'strong' || val === 'mạnh' ? 'Mạnh'
                                             : val === 'light' || val === 'soft' || val === 'nhẹ' ? 'Nhẹ'
                                             : rawStr;
                                strC[mapped] = (strC[mapped] || 0) + 1;
                            }
                        }
                    });
                }
            });

            // Find top values
            let topTF = 'N/A', mxTF = 0;
            for (const [f, c] of Object.entries(tfC)) if (c > mxTF) { mxTF = c; topTF = f; }
            let topStr = 'N/A', mxS = 0;
            for (const [s, c] of Object.entries(strC)) if (c > mxS) { mxS = c; topStr = s; }
            let topLn = 'N/A', mxL = 0;
            for (const [l, c] of Object.entries(lnC)) if (c > mxL) { mxL = c; topLn = LANG_MAP[l] || l; }

            const fSvc = Object.entries(svcC).sort(([, a], [, b]) => b - a).slice(0, 3).map(([id, c]) => {
                const s = svcMap.get(id) || { name: id, dur: 0 };
                return s.name + (s.dur ? ` ${s.dur}p` : '') + (c > 1 ? ` (${c} lan)` : '');
            }).join(', ') || 'N/A';

            const fKtv = Object.entries(ktvC).sort(([, a], [, b]) => b - a).slice(0, 3).map(([code, c]) =>
                (stfMap.get(code) || code) + (c > 1 ? ` (${c} lan)` : '')
            ).join(', ') || 'N/A';

            const genderDisplay = cust.gender ? (GENDER_DISPLAY[cust.gender] || cust.gender) : 'Nam';

            const tDates = filtered.map((b: any) => {
                const d = new Date((b.bookingDate.endsWith('Z') ? b.bookingDate : b.bookingDate + 'Z'));
                return new Date(d.getTime() + 7 * 3600000).toLocaleDateString('vi-VN');
            });
            const uniqueDates = [...new Set(tDates)].join(', ');
            const totalSpent = filtered.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
            const sources = [...new Set(filtered.map((b: any) => b.source).filter(Boolean))].join(', ') || 'N/A';
            
            const isGroup = filtered.some((b: any) => b.guestCount > 1);
            const guestType = isGroup ? 'Khach nhom' : 'Khach le';
            const guestClass = filtered.length > 1 ? 'Khach cu' : 'Khach moi';

            rows.push([
                cust.fullName || 'N/A', cust.phone || 'N/A', cust.email || 'N/A',
                genderDisplay, topLn, cust.nationality || 'N/A', guestType, guestClass, String(filtered.length), String(totalSpent),
                uniqueDates, topTF, topStr, String(vip), fSvc, fKtv, sources, cust.notes || ''
            ]);
        }

        // Sort by total spent descending
        rows.sort((a, b) => Number(b[9]) - Number(a[9]));

        // Build CSV
        const header = [
            'Ten Khach Hang', 'SDT', 'Email', 'Gioi Tinh', 'Ngon Ngu', 'Quoc Tich', 'Loai Khach', 'Phan Loai (Moi/Cu)',
            `So Lan Den (${dateLabel})`, `Tong Chi Tieu (${dateLabel})`, 'Ngay Den',
            'Khung Gio', 'Luc Ua Thich', 'VIP Menu', 'Dich Vu Su Dung',
            'KTV Phuc Vu', 'Loai Don', 'Ghi Chu'
        ];

        const format = searchParams.get('format') || 'csv';
        if (format === 'json') {
            return NextResponse.json({ success: true, data: { header, rows } });
        }
        const fileExt = format === 'xlsx' ? 'xlsx' : 'csv';
        const fileName = hasDateFilter
            ? `CRM_${fromDate}_to_${toDate}.${fileExt}`
            : `CRM_full_export_${new Date().toISOString().slice(0, 10)}.${fileExt}`;

        if (format === 'xlsx') {
            const worksheet = xlsx.utils.aoa_to_sheet([header, ...rows]);
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, worksheet, 'CRM Data');
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            return new NextResponse(buffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${fileName}"`,
                },
            });
        }

        // Default: CSV
        const csvContent = '\uFEFF' + [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (error: any) {
        console.error('API Error (Customers Export):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
