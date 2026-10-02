/**
 * Tên phòng để HIỂN THỊ cho người đọc.
 *
 * `BookingItems.roomName` và `segments[].roomId` lưu MÃ phòng ("T", "V1", "PG"…),
 * không phải tên gọi ngoài đời. Riêng "T" là tầng trệt — thợ và quầy đều gọi là
 * "Trệt", không ai gọi "phòng T".
 *
 * Không tra được từ bảng `Rooms`: dòng đó đang để `name` = "T", đúng bằng mã, nên
 * có join cũng không ra thêm gì. Quy đổi đặt ở đây, một chỗ duy nhất.
 *
 * Mã không có trong bảng thì giữ nguyên — V1, V2, V3, V4, PG, YUMI vốn đã là tên
 * gọi thật rồi.
 */
const ROOM_LABELS: Record<string, string> = {
    T: 'Trệt',
};

export function roomLabel(code?: string | null): string {
    const raw = String(code ?? '').trim();
    if (!raw) return '';
    return ROOM_LABELS[raw.toUpperCase()] || raw;
}
