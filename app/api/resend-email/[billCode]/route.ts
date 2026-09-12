import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendBookingConfirmationEmail } from '@/lib/email';
import { buildServiceSection, extractBookingNote } from '@/lib/booking-email.logic';
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
          guest_id,
          options,
          Services!BookingItems_serviceId_fkey (
            nameVN, nameEN, nameKR, nameJP, nameCN, duration, is_utility
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

    const lang = bData.customerLang || 'vi';
    const bookingDetails = {
        bookingId: bData.billCode || bData.id,
        date: bData.bookingDate || '',
        time: bData.timeBooking || '',
        depositAmount: depositAmountVND,
        totalAmount: bData.totalAmount || 0,
        therapist: (bData.technicianCode || '').trim(),
        note: extractBookingNote(bData.notes),
        ...buildServiceSection(bData.BookingItems, lang),
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
