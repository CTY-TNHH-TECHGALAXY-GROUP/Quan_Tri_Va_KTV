/**
 * GET /api/reception/tax-lookup?taxCode=0316794479
 *
 * Tra cứu tên / địa chỉ công ty theo mã số thuế cho form "Tạo đơn nhanh" (hoá đơn VAT).
 * Port từ WRB nội bộ `src/app/api/tax-lookup/route.ts`: gọi VietQR + Esgoo song song,
 * ghép kết quả (VietQR ưu tiên tên/địa chỉ, Esgoo bổ sung SĐT/người đại diện).
 * Chỉ quầy có quyền `dispatch_board` mới gọi được; không cần env mới.
 */
import { NextResponse } from 'next/server';
import https from 'https';
import { requirePermission } from '@/lib/auth-server';
import { normalizeTaxCode } from '@/lib/services/CustomerVatService';

export const dynamic = 'force-dynamic';

// 🔧 CONFIGURATION
const VIETQR_API_URL = 'https://api.vietqr.io/v2/business';
const ESGOO_API_URL = 'https://esgoo.net/api-mst';
const API_TIMEOUT_MS = 8000;

const BROWSER_HEADERS = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function fetchUrl(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.get(
            { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: BROWSER_HEADERS },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
            }
        );
        req.on('error', reject);
        req.setTimeout(API_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error('TIMEOUT'));
        });
    });
}

async function fetchVietQR(taxCode: string) {
    try {
        const { status, body } = await fetchUrl(`${VIETQR_API_URL}/${taxCode}`);
        if (status !== 200) return null;
        const data = JSON.parse(body);
        if (data.code === '00' && data.data) {
            return {
                companyName: data.data.name || '',
                address: data.data.address || '',
                internationalName: data.data.internationalName || '',
            };
        }
        return null;
    } catch {
        return null;
    }
}

/** Esgoo trả 2 định dạng tuỳ MST: A `{ ten, dc, dt, daidien, tinhtrang }` hoặc B `{ name, address, status }`. */
async function fetchEsgoo(taxCode: string) {
    try {
        const { status, body } = await fetchUrl(`${ESGOO_API_URL}/${taxCode}.htm`);
        if (status !== 200) return null;
        const data = JSON.parse(body);
        if (data.error === 0 && data.data) {
            const d = data.data;
            const isFormatA = !!d.ten || !!d.dt;
            return {
                companyName: (isFormatA ? d.ten : d.name) || '',
                address: (isFormatA ? d.dc : d.address) || '',
                phone: d.dt || '',
                representative: d.daidien || '',
                status: (isFormatA ? d.tinhtrang : d.status) || '',
            };
        }
        return null;
    } catch {
        return null;
    }
}

export async function GET(request: Request) {
    try {
        await requirePermission('dispatch_board');
    } catch (error: any) {
        const status = error?.message === 'Forbidden' ? 403 : 401;
        return NextResponse.json({ success: false, error: error?.message || 'Unauthorized' }, { status });
    }

    const rawTaxCode = new URL(request.url).searchParams.get('taxCode');
    const taxCode = normalizeTaxCode(rawTaxCode);
    if (!taxCode) {
        return NextResponse.json({ success: false, error: 'Mã số thuế không hợp lệ (10 số, hoặc 10 số + 3 số chi nhánh)' }, { status: 400 });
    }

    try {
        // Hai nguồn tra theo MST không gạch nối.
        const lookupCode = taxCode.replace('-', '');
        const [vietqr, esgoo] = await Promise.all([fetchVietQR(lookupCode), fetchEsgoo(lookupCode)]);
        if (!vietqr && !esgoo) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy mã số thuế này' }, { status: 404 });
        }
        return NextResponse.json({
            success: true,
            data: {
                taxCode,
                companyName: vietqr?.companyName || esgoo?.companyName || '',
                companyAddress: vietqr?.address || esgoo?.address || '',
                companyPhone: esgoo?.phone || '',
                internationalName: vietqr?.internationalName || '',
                representative: esgoo?.representative || '',
                status: esgoo?.status || '',
            },
        });
    } catch (error: any) {
        if (error?.message === 'TIMEOUT') {
            return NextResponse.json({ success: false, error: 'Tra cứu quá thời gian, thử lại' }, { status: 504 });
        }
        console.error('[tax-lookup] Error:', error?.message);
        return NextResponse.json({ success: false, error: 'Tra cứu thất bại, thử lại' }, { status: 500 });
    }
}
