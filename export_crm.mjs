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
    if (extraFilter) {
      query = extraFilter(query);
    }
    const { data, error } = await query;
    if (error) {
      console.error(`Error fetching ${tableName}:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    
    allData = allData.concat(data);
    
    if (data.length < limit) break;
    from += limit;
  }
  return allData;
}

function generateReport(customerMap, bookingsByEntity, itemsByBooking, serviceMap, staffMap, startDate, endDate, filename) {
  const reportData = [];
  const now = new Date('2026-07-04T23:59:59+07:00'); // Mốc thời gian chuẩn để tính số ngày

  for (const entityId of Object.keys(bookingsByEntity)) {
    const allCustBookings = bookingsByEntity[entityId] || [];
    if (allCustBookings.length === 0) continue;
    
    // Lấy customer gốc từ DB
    const baseCustomerId = entityId.split('_')[0];
    const baseCustomer = customerMap[baseCustomerId] || {};
    
    // Tên hiển thị (Ưu tiên lấy tên trên Booking cuối cùng nếu bị tách nhóm)
    let displayFullName = baseCustomer.fullName || 'N/A';
    if (entityId.includes('_')) {
       // Lấy tên từ đơn hàng đầu tiên trong mảng
       const specificName = allCustBookings[0].customerName;
       if (specificName) displayFullName = specificName;
    }
    
    // Đếm số ngày đến trên toàn lịch sử
    const uniqueLifetimeDates = new Set();
    let ngayDenDauTien = null;
    let ngayDenGanNhatToanThoiGian = null;
    
    allCustBookings.forEach(b => {
      const bDate = new Date(b.bookingDate);
      uniqueLifetimeDates.add(bDate.toLocaleDateString('vi-VN'));
      
      if (!ngayDenDauTien || bDate < ngayDenDauTien) ngayDenDauTien = bDate;
      if (!ngayDenGanNhatToanThoiGian || bDate > ngayDenGanNhatToanThoiGian) ngayDenGanNhatToanThoiGian = bDate;
    });

    const totalLifetimeVisits = uniqueLifetimeDates.size;
    
    if (totalLifetimeVisits === 0) continue;

    // Lọc các đơn hàng chỉ nằm trong khoảng thời gian (Timeframe) được yêu cầu
    const timeframeBookings = allCustBookings.filter(b => {
      const bDate = new Date(b.bookingDate);
      return bDate >= startDate && bDate <= endDate;
    });

    // Nếu khách không có đơn nào trong giai đoạn này, bỏ qua khỏi báo cáo
    if (timeframeBookings.length === 0) continue;

    let tongChiTieuGiaiDoan = 0;
    
    const uniqueTimeframeDates = new Set();
    const unique7Days = new Set();
    const unique30Days = new Set();
    
    const serviceCounts = {};
    const utilitiesUsed = new Set();
    const ktvCounts = {};
    const timeFrames = {};
    const usedSources = new Set();
    let usedVipMenu = false;
    
    let totalRatingScore = 0;
    let totalRatings = 0;
    const feedbacks = [];
    const ktvEvaluations = [];
    
    const genderReqs = new Set();
    const strengthReqs = new Set();
    const focusAreas = new Set();

    timeframeBookings.forEach(b => {
      tongChiTieuGiaiDoan += Number(b.totalAmount || 0);

      const bDate = new Date(b.bookingDate);
      const dateStr = bDate.toLocaleDateString('vi-VN');
      
      uniqueTimeframeDates.add(dateStr);

      // Tính nguồn đơn hàng và VIP Menu
      if (b.source) {
        usedSources.add(b.source);
        if (b.source.toUpperCase().includes('VIP')) {
            usedVipMenu = true;
        }
      }

      // Tính khung giờ (Theo múi giờ Việt Nam, khoảng cách 1 tiếng)
      // Quan trọng: Thêm 'Z' vào cuối chuỗi từ DB để JS hiểu đây là giờ UTC trước khi convert
      const safeDateStr = b.bookingDate.endsWith('Z') ? b.bookingDate : b.bookingDate + 'Z';
      const vnTimeStr = new Date(safeDateStr).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
      const vnDate = new Date(vnTimeStr);
      const hour = vnDate.getHours();
      
      const frame = `${hour}h-${hour + 1}h`;
      timeFrames[frame] = (timeFrames[frame] || 0) + 1;

      const diffTime = Math.abs(endDate - bDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      if (diffDays <= 7) unique7Days.add(dateStr);
      if (diffDays <= 30) unique30Days.add(dateStr);

      if (b.focusAreaNote) focusAreas.add(b.focusAreaNote);
      
      if (b.notes && b.notes.includes('[Đánh giá KTV:')) {
        const matches = [...b.notes.matchAll(/\[Đánh giá KTV:\s*(.*?)\]/g)];
        matches.forEach(match => {
          if (match && match[1]) {
            ktvEvaluations.push(`[${bDate.toLocaleDateString('vi-VN')}] ${match[1]}`);
          }
        });
      }
      
      const bItems = itemsByBooking[b.id] || [];
      bItems.forEach(item => {
        if (item.serviceId) {
          const sName = serviceMap[item.serviceId] || '';
          if (sName.toLowerCase().includes('phòng riêng') || sName.toLowerCase().includes('phong rieng')) {
            utilitiesUsed.add(sName);
          } else {
            serviceCounts[item.serviceId] = (serviceCounts[item.serviceId] || 0) + 1;
          }
        }
        
        if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
          item.technicianCodes.forEach(ktvCode => {
            ktvCounts[ktvCode] = (ktvCounts[ktvCode] || 0) + 1;
          });
        }

        if (item.itemRating) {
          totalRatingScore += item.itemRating;
          totalRatings++;
        }
        if (item.itemFeedback && item.itemFeedback.trim() !== '') {
          feedbacks.push(`[${new Date(b.bookingDate).toLocaleDateString('vi-VN')}] ${item.itemFeedback.replace(/"/g, '""')}`);
        }
        
        if (item.options) {
          if (item.options.therapist) genderReqs.add(item.options.therapist);
          if (item.options.strength) strengthReqs.add(item.options.strength);
          if (item.options.focus && Array.isArray(item.options.focus)) {
            item.options.focus.forEach(f => focusAreas.add(f));
          }
        }
      });
    });

    const topServiceId = Object.keys(serviceCounts).sort((a, b) => serviceCounts[b] - serviceCounts[a])[0];
    const topService = topServiceId ? (serviceMap[topServiceId] || topServiceId) : 'N/A';

    const topKtvCode = Object.keys(ktvCounts).sort((a, b) => ktvCounts[b] - ktvCounts[a])[0];
    const topKtvName = topKtvCode ? staffMap[topKtvCode] : null;
    const topKtv = topKtvCode ? (topKtvName ? `${topKtvName} (${topKtvCode})` : topKtvCode) : 'N/A';
    const tatCaMaKtvDaLam = Object.keys(ktvCounts).join(', ') || 'N/A';

    let mostFrequentTimeFrame = 'N/A';
    let maxFrameCount = 0;
    for (const [frame, count] of Object.entries(timeFrames)) {
        if (count > maxFrameCount) {
            maxFrameCount = count;
            mostFrequentTimeFrame = frame;
        }
    }

    const avgRating = totalRatings > 0 ? `${(totalRatingScore / totalRatings).toFixed(1)} Sao (Từ ${totalRatings} lượt đánh giá)` : 'Chưa đánh giá';

    reportData.push({
      Tên_Khách_Hàng: displayFullName,
      Số_Điện_Thoại: baseCustomer.phone ? `'${baseCustomer.phone}` : 'N/A', 
      Email: baseCustomer.email || 'N/A',
      Phân_Loại_Dựa_Trên_Lịch_Sử: totalLifetimeVisits > 1 ? 'Khách Cũ' : 'Khách Mới',
      Ngày_Đến_Đầu_Tiên: ngayDenDauTien ? ngayDenDauTien.toLocaleDateString('vi-VN') : 'N/A',
      Ngày_Đến_Gần_Nhất: ngayDenGanNhatToanThoiGian ? ngayDenGanNhatToanThoiGian.toLocaleDateString('vi-VN') : 'N/A',
      Tổng_Số_Ngày_Đến_Trong_Giai_Đoạn: uniqueTimeframeDates.size,
      Số_Ngày_Đến_Trong_30_Ngày_Cuối: unique30Days.size,
      Số_Ngày_Đến_Trong_7_Ngày_Cuối: unique7Days.size,
      Tổng_Chi_Tiêu_Trong_Giai_Đoạn: tongChiTieuGiaiDoan,
      Khung_Giờ_Thường_Đến: mostFrequentTimeFrame,
      Loại_Đơn_Đã_Sử_Dụng: Array.from(usedSources).join(', ') || 'N/A',
      Đã_Sử_Dụng_Menu_VIP: usedVipMenu ? 'Có' : 'Không',
      Dịch_Vụ_Thường_Dùng_Nhất: topService,
      Tiện_Ích_Sử_Dụng: Array.from(utilitiesUsed).join(', ') || 'Không',
      KTV_Thường_Làm_Nhất: topKtv,
      Lịch_Sử_Mã_KTV_Đã_Làm: tatCaMaKtvDaLam,
      Giới_Tính_KTV_Yêu_Cầu: Array.from(genderReqs).join(', ') || 'N/A',
      Lực_Massage_Yêu_Cầu: Array.from(strengthReqs).join(', ') || 'N/A',
      Các_Điểm_Tập_Trung: Array.from(focusAreas).join(', ') || 'N/A',
      Trung_Bình_Sao_Đánh_Giá: avgRating,
      Phản_Hồi_Của_Khách: feedbacks.join(' | ') || 'Không có',
      KTV_Đánh_Giá_Khách_Hàng: ktvEvaluations.join(' | ') || 'Chưa đánh giá',
    });
  }

  reportData.sort((a, b) => b.Tổng_Chi_Tiêu_Trong_Giai_Đoạn - a.Tổng_Chi_Tiêu_Trong_Giai_Đoạn);

  const csvHeaders = [
    'Tên_Khách_Hàng', 'Số_Điện_Thoại', 'Email', 'Phân_Loại_Dựa_Trên_Lịch_Sử', 
    'Ngày_Đến_Đầu_Tiên', 'Ngày_Đến_Gần_Nhất', 
    'Tổng_Số_Ngày_Đến_Trong_Giai_Đoạn', 'Số_Ngày_Đến_Trong_30_Ngày_Cuối', 'Số_Ngày_Đến_Trong_7_Ngày_Cuối',
    'Tổng_Chi_Tiêu_Trong_Giai_Đoạn', 
    'Khung_Giờ_Thường_Đến', 'Loại_Đơn_Đã_Sử_Dụng', 'Đã_Sử_Dụng_Menu_VIP',
    'Dịch_Vụ_Thường_Dùng_Nhất', 'Tiện_Ích_Sử_Dụng', 
    'KTV_Thường_Làm_Nhất', 'Lịch_Sử_Mã_KTV_Đã_Làm',
    'Giới_Tính_KTV_Yêu_Cầu', 'Lực_Massage_Yêu_Cầu', 'Các_Điểm_Tập_Trung',  
    'Trung_Bình_Sao_Đánh_Giá', 'Phản_Hồi_Của_Khách', 'KTV_Đánh_Giá_Khách_Hàng'
  ];
  
  let csvContent = '\uFEFF'; 
  csvContent += csvHeaders.join(',') + '\n';
  
  reportData.forEach(row => {
    const rowValues = csvHeaders.map(h => {
      let val = row[h] ? row[h].toString() : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvContent += rowValues.join(',') + '\n';
  });

  const outputPath = path.resolve(__dirname, filename);
  fs.writeFileSync(outputPath, csvContent, 'utf8');
  console.log(`Export success! Saved to: ${outputPath}`);
}

async function main() {
  console.log('Fetching ALL data from Supabase...');
  
  const customers = await fetchAll('Customers', 'id, fullName, phone, email, lastVisited');
  const bookings = await fetchAll('Bookings', 'id, customerId, customerName, bookingDate, status, focusAreaNote, notes, totalAmount, source', (q) => 
    q.in('status', ['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE'])
  );
  const bookingItems = await fetchAll('BookingItems', 'id, bookingId, serviceId, technicianCodes, ktvRatings, itemFeedback, itemRating, options');
    
  const { data: services } = await supabase.from('Services').select('id, nameVN');
  const { data: staff } = await supabase.from('Staff').select('id, full_name');

  const serviceMap = {};
  if (services) services.forEach(s => serviceMap[s.id] = s.nameVN);

  const staffMap = {};
  if (staff) staff.forEach(s => staffMap[s.id] = s.full_name);

  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  const bookingsByEntity = {};
  
  bookings.forEach(b => {
    const c = customerMap[b.customerId];
    let entityId = b.customerId;
    
    // Nếu là tài khoản dùng chung (Khách vãng lai có SĐT chứa chữ GUEST)
    if (c && c.phone && c.phone.toUpperCase().includes('GUEST')) {
      const bName = b.customerName ? b.customerName.trim().toUpperCase() : 'KHÁCH_LẺ_KHÔNG_TÊN';
      entityId = `${b.customerId}_${bName}`;
    }
    
    if (!bookingsByEntity[entityId]) bookingsByEntity[entityId] = [];
    bookingsByEntity[entityId].push(b);
  });

  const itemsByBooking = {};
  bookingItems.forEach(item => {
    if (!itemsByBooking[item.bookingId]) itemsByBooking[item.bookingId] = [];
    itemsByBooking[item.bookingId].push(item);
  });

  console.log(`\nProcessing ${Object.keys(bookingsByEntity).length} distinct customer entities with ${bookings.length} valid bookings...`);

  // 1. Dữ liệu tháng 6
  const t6Start = new Date('2026-06-01T00:00:00+07:00');
  const t6End = new Date('2026-06-30T23:59:59+07:00');
  generateReport(customerMap, bookingsByEntity, itemsByBooking, serviceMap, staffMap, t6Start, t6End, 'Bao_Cao_CRM_Thang_6_v9.csv');

  // 2. Dữ liệu 2 tuần gần nhất (tính từ 4/7) -> 21/6 đến 4/7
  const w2Start = new Date('2026-06-21T00:00:00+07:00');
  const w2End = new Date('2026-07-04T23:59:59+07:00');
  generateReport(customerMap, bookingsByEntity, itemsByBooking, serviceMap, staffMap, w2Start, w2End, 'Bao_Cao_CRM_2_Tuan_Gan_Nhat_v9.csv');

  // 3. Dữ liệu 1 tuần gần nhất (tính từ 4/7) -> 28/6 đến 4/7
  const w1Start = new Date('2026-06-28T00:00:00+07:00');
  const w1End = new Date('2026-07-04T23:59:59+07:00');
  generateReport(customerMap, bookingsByEntity, itemsByBooking, serviceMap, staffMap, w1Start, w1End, 'Bao_Cao_CRM_1_Tuan_Gan_Nhat_v9.csv');

}

main().catch(console.error);
