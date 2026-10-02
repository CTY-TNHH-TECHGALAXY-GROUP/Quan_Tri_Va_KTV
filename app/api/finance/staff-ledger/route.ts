import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const authErr = await requirePermission('finance_management').catch(e => e);
        const denied = authErrorResponse(authErr);
        if (denied) return denied;

        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId') || 'ALL';
        const fromDate = searchParams.get('fromDate') || '';
        const toDate = searchParams.get('toDate') || '';
        const direction = searchParams.get('direction') || 'ALL'; // 'IN' | 'OUT' | 'ALL'
        const typeFilter = searchParams.get('type') || 'ALL';
        const search = (searchParams.get('search') || '').trim().toLowerCase();
        const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') || '300', 10)));

        // 1. Lấy danh sách nhân viên để map tên & loại hợp đồng
        const { data: staffList } = await supabase
            .from('Staff')
            .select('id, full_name, work_type');
        
        const staffMap: Record<string, { name: string; workType: string }> = {};
        (staffList || []).forEach(s => {
            staffMap[s.id] = { name: s.full_name || s.id, workType: s.work_type || 'TYPE_A' };
        });

        const items: any[] = [];

        // 2. Lấy dữ liệu tua từ KTVDTurnLedger (chủ đạo Type D & chặng chi tiết)
        let turnQuery = supabase
            .from('KTVDTurnLedger')
            .select('id, staff_id, bill_code, service_name, commission_gross, commission_net, bonus_amount, tip, tax_amount, created_at, work_date, paid_minutes, deduction_rate, rating_used')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (staffId && staffId !== 'ALL') {
            turnQuery = turnQuery.eq('staff_id', staffId);
        }
        if (fromDate) {
            turnQuery = turnQuery.gte('work_date', fromDate);
        }
        if (toDate) {
            turnQuery = turnQuery.lte('work_date', toDate);
        }

        const { data: turnsData } = await turnQuery;

        (turnsData || []).forEach(t => {
            const staffInfo = staffMap[t.staff_id] || { name: t.staff_id, workType: 'TYPE_D' };
            const tienTua = Number(t.commission_net || 0) + Number(t.bonus_amount || 0);

            // A. Tiền tua (Cộng tiền vào)
            if (tienTua > 0) {
                let noteDetail = `${t.service_name || 'Dịch vụ'} · ${Math.round(t.paid_minutes || 0)} phút`;
                if (Number(t.bonus_amount) > 0) {
                    noteDetail += ` (Thưởng 4★: +${Math.round(t.bonus_amount).toLocaleString('vi-VN')}đ)`;
                }
                if (Number(t.deduction_rate) > 0) {
                    noteDetail += ` (Trừ đánh giá: -${Math.round(t.deduction_rate * 100)}%)`;
                }

                items.push({
                    id: `${t.id}_comm`,
                    sourceId: t.id,
                    staffId: t.staff_id,
                    staffName: staffInfo.name,
                    workType: staffInfo.workType,
                    type: 'COMMISSION',
                    direction: 'IN',
                    title: `Tiền tua đơn ${t.bill_code || ''}`,
                    amount: tienTua,
                    note: noteDetail,
                    billCode: t.bill_code,
                    serviceName: t.service_name,
                    createdAt: t.created_at,
                    workDate: t.work_date,
                    status: 'APPROVED',
                });
            }

            // B. Tiền Tip (Cộng tiền vào)
            if (Number(t.tip) > 0) {
                items.push({
                    id: `${t.id}_tip`,
                    sourceId: t.id,
                    staffId: t.staff_id,
                    staffName: staffInfo.name,
                    workType: staffInfo.workType,
                    type: 'TIP',
                    direction: 'IN',
                    title: `Tiền Tip đơn ${t.bill_code || ''}`,
                    amount: Number(t.tip),
                    note: `Khách thưởng KTV đơn ${t.bill_code || ''}`,
                    billCode: t.bill_code,
                    serviceName: t.service_name,
                    createdAt: t.created_at,
                    workDate: t.work_date,
                    status: 'APPROVED',
                });
            }

            // C. Thuế TNCN (Trừ tiền ra)
            if (Number(t.tax_amount) > 0) {
                items.push({
                    id: `${t.id}_tax`,
                    sourceId: t.id,
                    staffId: t.staff_id,
                    staffName: staffInfo.name,
                    workType: staffInfo.workType,
                    type: 'TAX',
                    direction: 'OUT',
                    title: `Thuế TNCN đơn ${t.bill_code || ''}`,
                    amount: -Number(t.tax_amount),
                    note: 'Khấu trừ thuế TNCN 10%',
                    billCode: t.bill_code,
                    serviceName: t.service_name,
                    createdAt: t.created_at,
                    workDate: t.work_date,
                    status: 'APPROVED',
                });
            }
        });

        // 3. Lấy dữ liệu điều chỉnh / thưởng phạt từ WalletAdjustments
        let adjQuery = supabase
            .from('WalletAdjustments')
            .select('id, staff_id, amount, reason, type, created_at, wallet_type')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (staffId && staffId !== 'ALL') {
            adjQuery = adjQuery.eq('staff_id', staffId);
        }
        if (fromDate) {
            adjQuery = adjQuery.gte('created_at', `${fromDate}T00:00:00Z`);
        }
        if (toDate) {
            adjQuery = adjQuery.lte('created_at', `${toDate}T23:59:59Z`);
        }

        const { data: adjData } = await adjQuery;

        (adjData || []).forEach(a => {
            const staffInfo = staffMap[a.staff_id] || { name: a.staff_id, workType: 'UNKNOWN' };
            const amt = Number(a.amount || 0);
            const isCredit = amt >= 0;
            const rLower = (a.reason || '').toLowerCase();

            let title = isCredit ? 'Thưởng hệ thống / Điều chỉnh' : 'Khấu trừ / Phạt hệ thống';
            if (rLower.includes('giặt đồ')) title = '🧦 Tiền giặt đồ';
            else if (rLower.includes('nghỉ đột xuất')) title = '⚠️ Phạt nghỉ đột xuất';
            else if (rLower.includes('thưởng')) title = '★ Thưởng quản lý';

            items.push({
                id: a.id,
                sourceId: a.id,
                staffId: a.staff_id,
                staffName: staffInfo.name,
                workType: staffInfo.workType,
                type: isCredit ? 'GIFT' : 'ADJUSTMENT',
                direction: isCredit ? 'IN' : 'OUT',
                title,
                amount: amt,
                note: a.reason || '',
                createdAt: a.created_at,
                workDate: a.created_at ? a.created_at.split('T')[0] : '',
                status: 'APPROVED',
            });
        });

        // 4. Lấy dữ liệu rút tiền từ KTVWithdrawals
        let withQuery = supabase
            .from('KTVWithdrawals')
            .select('id, staff_id, amount, note, request_date, status, wallet_type')
            .order('request_date', { ascending: false })
            .limit(limit);

        if (staffId && staffId !== 'ALL') {
            withQuery = withQuery.eq('staff_id', staffId);
        }
        if (fromDate) {
            withQuery = withQuery.gte('request_date', `${fromDate}T00:00:00Z`);
        }
        if (toDate) {
            withQuery = withQuery.lte('request_date', `${toDate}T23:59:59Z`);
        }

        const { data: withData } = await withQuery;

        (withData || []).forEach(w => {
            const amt = Math.abs(Number(w.amount || 0));
            // Bỏ qua intent 1đ
            if (amt <= 1) return;

            const staffInfo = staffMap[w.staff_id] || { name: w.staff_id, workType: 'UNKNOWN' };

            items.push({
                id: w.id,
                sourceId: w.id,
                staffId: w.staff_id,
                staffName: staffInfo.name,
                workType: staffInfo.workType,
                type: 'WITHDRAWAL',
                direction: 'OUT',
                title: 'Rút tiền mặt',
                amount: -amt,
                note: w.note || 'Yêu cầu rút tiền mặt tại quầy',
                createdAt: w.request_date,
                workDate: w.request_date ? w.request_date.split('T')[0] : '',
                status: w.status,
            });
        });

        // 5. Lọc theo direction ('IN' | 'OUT' | 'ALL')
        let filtered = items;
        if (direction === 'IN') {
            filtered = filtered.filter(i => i.direction === 'IN');
        } else if (direction === 'OUT') {
            filtered = filtered.filter(i => i.direction === 'OUT');
        }

        // 6. Lọc theo type nếu có
        if (typeFilter && typeFilter !== 'ALL') {
            filtered = filtered.filter(i => i.type === typeFilter);
        }

        // 7. Lọc theo search
        if (search) {
            filtered = filtered.filter(i => 
                (i.staffId && i.staffId.toLowerCase().includes(search)) ||
                (i.staffName && i.staffName.toLowerCase().includes(search)) ||
                (i.billCode && i.billCode.toLowerCase().includes(search)) ||
                (i.title && i.title.toLowerCase().includes(search)) ||
                (i.note && i.note.toLowerCase().includes(search))
            );
        }

        // 8. Sắp xếp theo ngày giờ mới nhất lên trên
        filtered.sort((a, b) => {
            const timeA = new Date(a.createdAt).getTime() || 0;
            const timeB = new Date(b.createdAt).getTime() || 0;
            return timeB - timeA;
        });

        // 9. Tính tổng summary
        let totalIn = 0;
        let totalOut = 0;
        let countIn = 0;
        let countOut = 0;

        filtered.forEach(i => {
            if (i.amount > 0) {
                totalIn += i.amount;
                countIn++;
            } else {
                totalOut += Math.abs(i.amount);
                countOut++;
            }
        });

        const netTotal = totalIn - totalOut;

        return NextResponse.json({
            success: true,
            data: {
                items: filtered.slice(0, limit),
                summary: {
                    totalIn,
                    totalOut,
                    netTotal,
                    countIn,
                    countOut,
                    totalCount: filtered.length,
                },
            },
        });
    } catch (error: any) {
        console.error('[staff-ledger] Error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Lỗi tải sổ đối soát' }, { status: 500 });
    }
}
