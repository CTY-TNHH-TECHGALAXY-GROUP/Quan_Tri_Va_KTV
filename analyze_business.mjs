import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

envFile.split('\n').forEach(line => {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) SUPABASE_URL = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) SUPABASE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchAll(tableName, selectStr, extraFilter = null) {
  let allData = [];
  let from = 0;
  const limit = 1000;
  while (true) {
    let query = supabase.from(tableName).select(selectStr).range(from, from + limit - 1);
    if (extraFilter) query = extraFilter(query);
    const { data, error } = await query;
    if (error) break;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < limit) break;
    from += limit;
  }
  return allData;
}

async function main() {
  console.log('Fetching data for Business Analysis...');
  
  const customers = await fetchAll('Customers', 'id, fullName, phone');
  const bookings = await fetchAll('Bookings', 'id, customerId, totalAmount, bookingDate, status', (q) => 
    q.in('status', ['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE'])
  );
  const bookingItems = await fetchAll('BookingItems', 'id, bookingId, serviceId, technicianCodes, itemRating, price');
  const services = await fetchAll('Services', 'id, nameVN');
  const staff = await fetchAll('Staff', 'id, full_name');

  const serviceMap = {};
  services.forEach(s => serviceMap[s.id] = s.nameVN);

  const staffMap = {};
  staff.forEach(s => staffMap[s.id] = s.full_name);

  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  // 1. Dịch vụ bán chạy nhất (Count and Revenue)
  const serviceStats = {};
  // 2. Nhân viên ưu tú nhất (Turns, Average Rating)
  const staffStats = {};
  // 3. Khách hàng chi nhiều nhất
  const customerSpending = {};

  // Process Bookings for Customer Spending
  bookings.forEach(b => {
    if (!customerSpending[b.customerId]) {
      customerSpending[b.customerId] = { count: 0, totalAmount: 0 };
    }
    customerSpending[b.customerId].count++;
    customerSpending[b.customerId].totalAmount += Number(b.totalAmount || 0);
  });

  // Process BookingItems for Services and Staff
  bookingItems.forEach(item => {
    // Services
    if (item.serviceId) {
      if (!serviceStats[item.serviceId]) serviceStats[item.serviceId] = { count: 0, revenue: 0 };
      serviceStats[item.serviceId].count++;
      serviceStats[item.serviceId].revenue += Number(item.price || 0);
    }
    
    // Staff
    if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
      item.technicianCodes.forEach(code => {
        if (!staffStats[code]) staffStats[code] = { turns: 0, ratingSum: 0, ratingCount: 0 };
        staffStats[code].turns++;
        if (item.itemRating) {
          staffStats[code].ratingSum += item.itemRating;
          staffStats[code].ratingCount++;
        }
      });
    }
  });

  // Sort and display
  console.log('\n--- TOP 5 DỊCH VỤ BÁN CHẠY NHẤT (Theo số lượng) ---');
  const sortedServices = Object.keys(serviceStats).sort((a, b) => serviceStats[b].count - serviceStats[a].count);
  sortedServices.slice(0, 5).forEach(id => {
    console.log(`${serviceMap[id] || id}: ${serviceStats[id].count} lượt (Doanh thu ước tính: ${serviceStats[id].revenue.toLocaleString()} VND)`);
  });

  console.log('\n--- TOP 5 NHÂN VIÊN ƯU TÚ (Theo số tua làm) ---');
  const sortedStaff = Object.keys(staffStats).sort((a, b) => staffStats[b].turns - staffStats[a].turns);
  sortedStaff.slice(0, 5).forEach(id => {
    const avgRating = staffStats[id].ratingCount > 0 ? (staffStats[id].ratingSum / staffStats[id].ratingCount).toFixed(2) : 'N/A';
    console.log(`${staffMap[id] || id} (${id}): ${staffStats[id].turns} tua | Sao trung bình: ${avgRating}`);
  });
  
  console.log('\n--- TOP 5 NHÂN VIÊN ƯU TÚ (Theo đánh giá - Phải có > 5 lượt đánh giá) ---');
  const highlyRatedStaff = Object.keys(staffStats)
    .filter(id => staffStats[id].ratingCount > 5)
    .sort((a, b) => (staffStats[b].ratingSum / staffStats[b].ratingCount) - (staffStats[a].ratingSum / staffStats[a].ratingCount));
  highlyRatedStaff.slice(0, 5).forEach(id => {
    const avgRating = (staffStats[id].ratingSum / staffStats[id].ratingCount).toFixed(2);
    console.log(`${staffMap[id] || id} (${id}): Sao trung bình: ${avgRating} (dựa trên ${staffStats[id].ratingCount} lượt đánh giá) | Tổng tua: ${staffStats[id].turns}`);
  });

  console.log('\n--- TOP 10 KHÁCH HÀNG CHI NHIỀU NHẤT ---');
  const sortedCustomers = Object.keys(customerSpending).sort((a, b) => customerSpending[b].totalAmount - customerSpending[a].totalAmount);
  sortedCustomers.slice(0, 10).forEach(id => {
    const c = customerMap[id];
    const cName = c ? c.fullName : id;
    const cPhone = c ? c.phone : 'N/A';
    console.log(`${cName} (${cPhone}): Tổng chi ${customerSpending[id].totalAmount.toLocaleString()} VND | Số lần đến: ${customerSpending[id].count}`);
  });
  
  console.log('\n--- TỔNG QUAN ---');
  console.log(`Tổng doanh thu hệ thống đã ghi nhận (hoàn thành): ${Object.values(customerSpending).reduce((sum, c) => sum + c.totalAmount, 0).toLocaleString()} VND`);
  console.log(`Tổng số lượng đơn hàng hoàn thành: ${bookings.length}`);
}

main().catch(console.error);
