import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendBookingConfirmationEmail } from '@/lib/email';

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
        bookingDate, timeBooking, totalAmount, id,
        BookingItems!BookingItems_bookingId_fkey (
          quantity,
          serviceId,
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
      return NextResponse.json({ success: false, error: 'No email found for this booking' }, { status: 400 });
    }

    let depositAmountVND = 0;
    if (bData.totalAmount && bData.totalAmount > 0) {
        const rawDeposit = (bData.totalAmount * 50) / 100;
        depositAmountVND = Math.max(100000, Math.round(rawDeposit / 100000) * 100000);
    }

    let totalDuration = 0;
    let totalGuests = 0;
    const serviceList: { name: string; duration: number }[] = [];

    if (bData.BookingItems && Array.isArray(bData.BookingItems)) {
        bData.BookingItems.forEach((item: any) => {
            const qty = item.quantity || 1;
            totalGuests += qty;
            
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

    const bookingDetails = {
        bookingId: bData.billCode || bData.id,
        date: bData.bookingDate || '',
        time: bData.timeBooking || '',
        services: serviceList,
        duration: totalDuration,
        guests: totalGuests,
        depositAmount: depositAmountVND
    };

    await sendBookingConfirmationEmail(
        bData.customerEmail,
        bData.customerName || 'Quý khách',
        bData.customerLang || 'vi',
        true, // assume new customer for now
        bookingDetails
    );

    return NextResponse.json({ success: true, message: `Email resent to ${bData.customerEmail}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
