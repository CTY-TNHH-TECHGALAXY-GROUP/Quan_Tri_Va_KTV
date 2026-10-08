/**
 * Checklist Quầy hỗ trợ NH01 — nguồn: NH01_Checklist_Tracker_v2.html (bản demo đã duyệt).
 * Dữ liệu thuần, không đụng DB: seed_nh01_checklist.ts đọc file này.
 *
 * Mỗi dòng: [khu vực, nội dung, số ảnh]. Khu vực nối bằng " - " = nhiều khu vực.
 * Ô ảnh được dựng bởi buildPhotoSlots(): số ảnh = số khu vực → mỗi khu vực 1 ô; nếu không khớp → "<khu vực> · ảnh i".
 * Các việc có nhãn ô rõ trong nội dung thì ghi đè ở SLOT_OVERRIDES.
 */

export type Row = [area: string, content: string, photos: number];

export interface DailyBlock { time: string; title: string; items: Row[] }

export const DAILY_BLOCKS: DailyBlock[] = [
  { time: 'Trước 09:00', title: 'Chuẩn bị sân ngoài', items: [
    ['Sân ngoài', 'Quét dọn sạch rác sân ngoài', 1],
    ['Sân ngoài', 'Lau sạch và setup bàn ghế ngoài sân đúng vị trí', 1],
    ['Sân ngoài', 'Lau sạch và đặt menu đứng kèm menu lật ngay ngắn ngoài sân', 1],
    ['Sân ngoài', 'Sắp xếp xe quầy ngoài sân gọn gàng, ngăn nắp', 1],
    ['Sân ngoài', 'Setup kệ dép khách ngay ngắn, đúng vị trí, gọn gàng ở đúng ngăn theo kích cỡ', 1],
    ['Sân ngoài', 'Quay mái hiên ra', 1],
    ['Sân ngoài', 'Mở hệ thống đèn sân', 3],
    ['Sân ngoài', 'Tưới cây 500ml nước', 1],
  ] },
  { time: 'Đúng 09:00', title: 'Mở sảnh & phòng gội', items: [
    ['Sảnh', 'Mở máy lạnh sảnh để làm mát không gian trước khi khách đến', 1],
    ['Sảnh', 'Mở nhạc sảnh', 1],
    ['Sảnh', 'Sạc máy tab', 1],
    ['Sảnh', 'Sạc đủ máy pos, kiểm tra giấy máy pos', 1],
    ['Sảnh', 'Bật hệ 1 công tắc đèn sảnh', 1],
    ['Sảnh', 'Ghim điện tủ nóng và đèn ở sảnh; sắp xếp lại đá, túi cổ, túi mắt trong tủ nóng ngay ngắn, gọn gàng', 1],
    ['Phòng Gội', 'Bật đèn và sắp gọn tủ trưng bày', 1],
    ['Phòng Gội', 'Mở CB (cầu dao) nước nóng', 1],
    ['Phòng Gội', 'Châm đầy tất cả bình thủy nước nóng đầu ca để sẵn sàng sử dụng', 1],
    ['Phòng Gội', 'Tưới cây 1 ly nước', 1],
    ['Sảnh', 'Kiểm tra đúng số lượng ghế tròn (5 cái)', 1],
  ] },
  { time: '09:00 – 09:30', title: 'Hoàn thiện set up', items: [
    ['Sảnh (Bàn thờ)', 'Lau dọn bàn thờ Ông Địa, kiểm tra và thay nước cúng đầu ca sạch sẽ', 1],
    ['Sảnh', 'Sắp xếp gọn khu vực uống nước của khách và vệ sinh sạch sẽ ly uống nước', 1],
    ['Sảnh', 'Nấu trà theo công thức 3 lá vối + 1.8L nước', 1],
    ['Sảnh', 'Sắp xếp quầy gọn gàng và kiểm tra số lượng văn phòng phẩm', 1],
    ['Phòng gội - Sảnh', 'Set up máy sấy đủ số lượng (PG: 1 máy) (Sảnh: 1 máy)', 2],
    ['Phòng Gội - Sảnh', 'Set up móc treo và giỏ đồ đúng vị trí và đúng số lượng', 3],
    ['Lầu 1', 'Ghim máy tinh dầu ở vệ sinh lầu 1, mở đèn buồng thay đồ và mở loa nhạc', 3],
  ] },
  { time: '09:00 – 17:00', title: 'Duy trì xuyên suốt ca', items: [
    ['Sảnh', 'Lau sạch cửa kính lớn ở sảnh để đảm bảo mặt tiền luôn sáng bóng', 1],
    ['Sảnh', 'Chuẩn bị sẵn sàng nồi xông thảo dược đầu ca - không để cạn nước gây cháy nổ', 1],
    // 12 ảnh = 4 khu vực × 3 mốc giờ → MULTI (xem MULTI_TIMES).
    ['Phòng Gội - Toilet lầu 1 - Toilet Yumi - Vip 4', 'Thay khăn lau tay mới các khu vực', 4],
  ] },
  { time: 'Trong ca', title: 'Chăm sóc & bổ sung linh hoạt', items: [
    ['Phòng gội', 'Giũ sạch bụi, kéo căng và vuốt phẳng phiu khăn trải giường', 1],
    ['Sảnh - Phòng Gội', 'Sắp xếp và báo cáo số lượng tất cả các loại vật tư trong kho PG và Sảnh (tối thiểu còn bao nhiêu báo lên để đặt, không được để thiếu sót cho khách hàng)', 2],
    ['Phòng Gội', 'Kiểm tra, phân loại và dọn bỏ các đồ cũ/hết hạn trong tủ lạnh', 1],
    ['Phòng Gội', 'Chăm tinh dầu xông', 1],
    ['Phòng Gội', 'Chăm nước rửa tay', 1],
    ['Phòng Gội', 'Chăm bột thảo dược rửa chân', 1],
    ['Phòng Gội - Sảnh', 'Chăm giấy khô - giấy ướt - khẩu trang - cồn', 3],
    ['Phòng Gội - Sảnh', 'Thay thảm và đặt đúng vị trí', 4],
    ['Phòng Gội - Sảnh', 'Chăm full tủ đồ khách', 3],
  ] },
  { time: 'Đúng 15:00', title: 'Chuẩn bị cuối ngày', items: [
    ['Sân ngoài', 'Quay mái hiên vào', 1],
  ] },
  { time: 'Từ 17:00', title: 'Đóng ca', items: [
    ['Sân ngoài', 'Mở hệ thống đèn bảng hiệu', 2],
    ['Sân ngoài', 'Bàn giao dụng cụ vệ sinh (Ki hốt rác - chổi cứng - chổi mềm)', 1],
    ['Phòng Gội', 'Gom đồ dơ lên phòng giặt và phân loại', 1],
    ['Sảnh - Phòng Gội', 'Thay bao rác mới', 2],
  ] },
];

/** Việc tuần: cùng một việc làm nhiều thứ → 1 việc mẫu, cron_schedule liệt kê các thứ (0 = CN). */
export const WEEKLY_ITEMS: { row: Row; days: number[] }[] = [
  { row: ['Sân ngoài', 'Thay dép khách', 1], days: [1] },
  { row: ['Phòng Gội', 'Thay khăn trải giường', 1], days: [1, 5] },
  { row: ['Phòng Gội', 'Thay áo gối', 1], days: [1, 5] },
  { row: ['Phòng Gội', 'Vệ sinh bằng khăn đa năng và thay nước máy xông mặt', 1], days: [2] },
  { row: ['Phòng Gội', 'Vệ sinh bằng khăn đa năng dụng cụ facial', 1], days: [2] },
  { row: ['Phòng Gội', 'Chăm rổ facial', 1], days: [2] },
  { row: ['Sảnh', 'Thay áo gối sảnh và áo gối ghế cắt tóc', 2], days: [3, 0] },
];

/** Nhãn ô lấy thẳng từ nội dung việc. */
export const SLOT_OVERRIDES: Record<string, string[]> = {
  'Ghim máy tinh dầu ở vệ sinh lầu 1, mở đèn buồng thay đồ và mở loa nhạc': ['Máy tinh dầu VS lầu 1', 'Đèn buồng thay đồ', 'Loa nhạc'],
  'Thay áo gối sảnh và áo gối ghế cắt tóc': ['Áo gối sảnh', 'Áo gối ghế cắt tóc'],
  'Set up máy sấy đủ số lượng (PG: 1 máy) (Sảnh: 1 máy)': ['Phòng gội', 'Sảnh'],
};

export const MULTI_TIMES: Record<string, string[]> = {
  'Thay khăn lau tay mới các khu vực': ['09:00', '13:00', '17:00'],
};

/** Số liệu có ghi rõ trong nội dung. */
export const EVIDENCE_OVERRIDES: Record<string, { kind: 'check' | 'count'; label: string; unit?: string; min?: number }[]> = {
  'Kiểm tra đúng số lượng ghế tròn (5 cái)': [{ kind: 'count', label: 'Số ghế tròn', unit: 'cái', min: 5 }],
};

export const buildPhotoSlots = ([area, content, photos]: Row): { label: string }[] => {
  const fixed = SLOT_OVERRIDES[content];
  if (fixed) return fixed.map(label => ({ label }));
  const areas = area.split(' - ').map(s => s.trim()).filter(Boolean);
  if (areas.length === photos) return areas.map(label => ({ label }));
  if (photos === 1) return [{ label: area }];
  return Array.from({ length: photos }, (_, i) => ({ label: `${area} · ảnh ${i + 1}` }));
};

// Tên hiển thị trên DB
export const PREFIX = 'NH01';
// Group names are what staff read as section headers — no branch prefix (the position already says NH01).
export const dailyCategoryName = (b: DailyBlock, i: number) => `${i + 1}. ${b.title} (${b.time})`;
export const WEEKLY_CATEGORY = '8. Việc theo thứ trong tuần';
/** Names used by the first seed (09/10/2026) — renamed in place so ids, sets and tasks stay linked. */
export const legacyCategoryNames = (newName: string) => [`${PREFIX} · ${newName}`, ...(newName === WEEKLY_CATEGORY ? [`${PREFIX} · Việc tuần`] : [])];
export const SET_DAY = 'Quầy hỗ trợ NH01 — Ngày';
export const SET_WEEK = 'Quầy hỗ trợ NH01 — Tuần';
export const POSITION = 'Quầy hỗ trợ NH01';
