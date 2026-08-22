import { createClient } from '@supabase/supabase-js';
const fs = require('fs');
const envConfig = fs.readFileSync('.env.local', 'utf8').split('\n').forEach((line: string) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

import { sendBookingConfirmationEmail } from '../lib/email';

async function run() {
  const billCode = '001-02072026';
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
    console.error("Not found", error);
    process.exit(1);
  }

  const pastBookings = []; // assume new customer
  let isNewCustomer = true;
  
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

  try {
      await sendBookingConfirmationEmail(
          bData.customerEmail,
          bData.customerName || 'Quý khách',
          bData.customerLang || 'vi',
          isNewCustomer,
          bookingDetails
      );
      console.log("Mail sent successfully!");
  } catch (err) {
      console.error("Error triggering email:", err);
  }
}

run();
