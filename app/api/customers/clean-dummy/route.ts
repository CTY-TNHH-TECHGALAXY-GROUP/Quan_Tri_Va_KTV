import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ error: 'Supabase Admin not initialized' }, { status: 500 });
        }

        // 1. Tìm tất cả các Customer bị dính lỗi "Aa" hoặc email rỗng nhưng có phone GUEST
        const { data: dummyCustomers, error: fetchErr } = await supabase
            .from('Customers')
            .select('*')
            .or('email.eq.aa,email.eq.a,fullName.eq.aa,fullName.eq.a');

        if (fetchErr) {
            console.error('Lỗi khi fetch dummy customers:', fetchErr);
            return NextResponse.json({ error: fetchErr.message }, { status: 500 });
        }

        if (!dummyCustomers || dummyCustomers.length === 0) {
            return NextResponse.json({ message: 'Không tìm thấy khách hàng ảo nào cần tách.' });
        }

        let totalSeparated = 0;

        // 2. Với mỗi customer rác, tìm tất cả Bookings của họ
        for (const c of dummyCustomers) {
            const { data: bookings } = await supabase
                .from('Bookings')
                .select('id, customerName')
                .eq('customerId', c.id);

            if (!bookings || bookings.length <= 1) {
                // Nếu chỉ có 1 booking hoặc 0, không cần tách (bản thân nó đã là 1 khách riêng)
                continue;
            }

            // Có >1 booking => Tách tất cả ra thành các ID riêng biệt
            for (const bk of bookings) {
                const ts = Date.now();
                const randomPart = Math.floor(Math.random() * 1000);
                const newCustomerId = `CUS-${ts}-${randomPart}`;
                
                // 2.1 Tạo khách hàng mới tinh cho booking này, COPY toàn bộ data từ khách gốc
                const { error: insErr } = await supabase.from('Customers').insert({
                    ...c, // Copy toàn bộ field của khách gốc (taxCode, companyName, notes...)
                    id: newCustomerId, // Đè ID mới
                    fullName: bk.customerName || c.fullName || 'Khách Vãng Lai',
                    email: `guest${ts}_${randomPart}@guest.com`,
                    phone: `GUEST-${ts}${randomPart}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });

                if (insErr) {
                    console.error('Lỗi tạo khách mới:', insErr);
                    continue;
                }

                // 2.2 Gắn mã khách hàng mới vào booking
                const { error: updErr } = await supabase.from('Bookings').update({
                    customerId: newCustomerId,
                    customerEmail: '' // Đè email rỗng luôn cho sạch
                }).eq('id', bk.id);
                
                if (updErr) {
                    console.error('Lỗi cập nhật booking:', updErr);
                    continue;
                }

                totalSeparated++;
            }

            // 3. KHÔNG ĐƯỢC XUẤT LỆNH DELETE KHÁCH GỐC NỮA ĐỂ TRÁNH MẤT DATA VAT/GHI CHÚ.
            // Vì các bookings đã được move hết sang ID mới, nên lần chạy sau khách gốc này 
            // sẽ có bookings.length === 0 và bị bỏ qua ở lệnh if (!bookings || bookings.length <= 1)
            // await supabase.from('Customers').delete().eq('id', c.id);
        }

        return NextResponse.json({ message: `Đã tách thành công ${totalSeparated} đơn hàng dính chùm vào các mã khách hàng ảo riêng biệt!` });

    } catch (error: any) {
        console.error('Lỗi tách khách ảo:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
