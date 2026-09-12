
const fs = require("fs");
const file = "components/shared/ScheduleBoard/ScheduleBoard.tsx";
let content = fs.readFileSync(file, "utf8");

const docHeader = `/**
 * ScheduleBoard.tsx - Lich Hen & Timeline KTV
 *
 * TINH NANG LICH HEN (PreBookings) - Them ngay 28/08/2026
 * --------------------------------------------------------
 * Tinh nang "Khach lien he truoc" (Pre-bookings) da duoc chuyen tu
 * Web Noi Bo (wrb-noi-bo-dev) sang tich hop truc tiep vao day.
 *
 * Chuc nang:
 *  1. Hien thi danh sach khach hen (PENDING) o sidebar ben phai.
 *  2. Them khach hen moi (Modal form: ten, SDT + ma quoc gia, email, so khach, ngay/gio, ghi chu).
 *  3. Nhan dien "Khach cu" - tu dong tra cuu bang Customers theo SDT.
 *  4. Click vao the khach hen -> mo tab Web Noi Bo tai /en/new-user/standard/menu
 *     kem query params de auto-fill thong tin o buoc Checkout.
 *
 * Database: Bang PreBookings (xem TableInSupabase.md muc 12).
 * Env var: NEXT_PUBLIC_WEB_NOI_BO_URL (URL Web Noi Bo de redirect).
 *
 * Phia Web Noi Bo: src/app/[lang]/new-user/[menuType]/menu/page.tsx
 *   co useEffect bat query params -> luu localStorage("contactedFirstInfo").
 */
`;

content = docHeader + content;
fs.writeFileSync(file, content, "utf8");
console.log("Doc header added successfully");

