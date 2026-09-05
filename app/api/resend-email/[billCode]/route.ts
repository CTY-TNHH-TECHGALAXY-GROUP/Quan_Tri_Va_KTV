import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendBookingConfirmationEmail } from '@/lib/email';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';
import { isDummyEmail } from '@/lib/customer.logic';

export async function GET(request: Request, context: { params: Promise<{ billCode: string }> }) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase admin not initialized');

    // Await params if it's a promise (Next.js 15+)
    const resolvedParams = await Promise.resolve(context.params);
    const billCode = resolvedParams.billCode;

    const { data: bData, error } = await supabase
      .from('Bookings')
      .select(`
        source, technicianCode, roomName, bedId, billCode, customerName, customerEmail, customerLang, customerPhone,
        bookingDate, timeBooking, totalAmount, id, notes,
        BookingItems!BookingItems_bookingId_fkey (
          quantity,
          serviceId,
          options,
          Services!BookingItems_serviceId_fkey (
            nameVN, nameEN, nameKR, nameJP, nameCN, duration
          )
        )
      `)
      .eq('billCode', billCode)
      .single();

    if (error || !bData) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    if (!bData.customerEmail) {
      return NextResponse.json({ success: false, error: 'Đơn này không có email khách hàng.' }, { status: 400 });
    }

    // Khách vãng lai được gán email ảo (guest...@guest.com): gửi tới đó chắc chắn
    // thất bại, nên báo rõ ràng thay vì để lỗi SMTP khó hiểu dội ngược lên.
    if (isDummyEmail(bData.customerEmail)) {
      return NextResponse.json(
        { success: false, error: `Đơn này chỉ có email ảo (${bData.customerEmail}), không gửi được. Cần cập nhật email thật của khách trước.` },
        { status: 400 }
      );
    }

    let depositAmountVND = 0;
    if (bData.totalAmount && bData.totalAmount > 0) {
        const rawDeposit = (bData.totalAmount * 50) / 100;
        depositAmountVND = Math.max(100000, Math.round(rawDeposit / 100000) * 100000);
    }

    let totalDuration = 0;
    let totalGuests = 0;
    const serviceList: { name: string; duration: number }[] = [];

    const focusSet = new Set<string>();
    const avoidSet = new Set<string>();
    const strengthSet = new Set<string>();
    const itemNotes: string[] = [];

    if (bData.BookingItems && Array.isArray(bData.BookingItems)) {
        bData.BookingItems.forEach((item: any) => {
            const qty = item.quantity || 1;
            totalGuests += qty;

            let opts = item.options ?? {};
            if (typeof opts === 'string') {
                try { opts = JSON.parse(opts); } catch { opts = {}; }
            }
            const focusStr = formatBodyAreas(opts.focus);
            const avoidStr = formatBodyAreas(opts.avoid);
            if (focusStr) focusSet.add(focusStr);
            if (avoidStr) avoidSet.add(avoidStr);
            if (opts.strength) strengthSet.add(normalizeStrength(opts.strength));
            const itemNote = opts.note || opts.customerNotes;
            if (itemNote) itemNotes.push(String(itemNote).trim());

            if (item.Services) {
                const dur = item.Services.duration || 0;
                totalDuration += dur;
                
                let sName = item.Services.nameEN || 'Service';
                if (bData.customerLang === 'vi') sName = item.Services.nameVN || sName;
                else if (bData.customerLang === 'kr') sName = item.Services.nameKR || sName;
                else if (bData.customerLang === 'jp') sName = item.Services.nameJP || sName;
                else if (bData.customerLang === 'cn') sName = item.Services.nameCN || sName;
                
                serviceList.push({ name: sName, duration: dur });
            }
        });
    }

    let bookingNote = '';
    if (bData.notes && typeof bData.notes === 'string') {
        const raw = bData.notes.trim();
        if (raw.startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                bookingNote = parsed.customerNote || parsed.note || '';
            } catch { bookingNote = ''; }
        } else {
            bookingNote = raw;
        }
    }

    const bookingDetails = {
        bookingId: bData.billCode || bData.id,
        date: bData.bookingDate || '',
        time: bData.timeBooking || '',
        services: serviceList,
        duration: totalDuration,
        guests: totalGuests,
        depositAmount: depositAmountVND,
        totalAmount: bData.totalAmount || 0,
        therapist: (bData.technicianCode || '').trim(),
        preferences: {
            focus: Array.from(focusSet).join(', '),
            avoid: Array.from(avoidSet).join(', '),
            strength: Array.from(strengthSet).join(', '),
        },
        note: [bookingNote, ...itemNotes].filter(Boolean).join('\n'),
    };

    await sendBookingConfirmationEmail(
        bData.customerEmail,
        bData.customerName || 'Quý khách',
        bData.customerLang || 'vi',
        true, // assume new customer for now
        bookingDetails,
        { force: true } // Gửi lại là thao tác thủ công của quản trị: bỏ qua công tắc bật/tắt
    );

    return NextResponse.json({ success: true, message: `Email resent to ${bData.customerEmail}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
