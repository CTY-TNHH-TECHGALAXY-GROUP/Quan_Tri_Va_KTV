/**
 * Text dictionary for "Việc của tôi" (Office P0 — staff checklist).
 */
export const t = {
  pageTitle: 'Việc của tôi',
  loading: 'Đang tải việc của bạn…',
  empty: 'Hôm nay chưa có việc nào được giao cho bạn.',
  noMatch: 'Không có việc nào khớp bộ lọc.',

  states: {
    OFFERED: 'Chờ nhận',
    TODO: 'Chưa làm',
    DOING: 'Đang làm',
    WAITING: 'Chờ duyệt',
    FIX: 'Cần sửa',
    APPROVED: 'Đã duyệt',
    BLOCKED: 'Báo vướng',
    DECLINED: 'Đã từ chối',
    CANCELLED: 'Đã huỷ',
  } as Record<string, string>,

  filters: { all: 'Tất cả', open: 'Chưa xong', fix: 'Cần sửa', waiting: 'Chờ duyệt', approved: 'Đã duyệt' },
  allGroups: 'Mọi nhóm',

  groups: {
    attention: 'Cần chú ý',
    attentionHint: 'cần sửa, chờ nhận, đột xuất, tồn',
    suggestion: 'thứ tự gợi ý, không khoá',
  },

  tags: {
    adhoc: 'Đột xuất',
    carry: (d: string) => `Tồn từ ${d}`,
    noBlock: 'Không chặn tan ca',
    deadline: (hhmm: string) => `Hạn ${hhmm}`,
    window: (a: string, b: string) => `Khung ${a}–${b}`,
    multi: (hhmm: string) => `Mốc ${hhmm}`,
    priority: 'Ưu tiên',
  },

  gate: {
    free: 'Đủ điều kiện tan ca',
    blocked: (n: number) => `Còn ${n} việc trước khi tan ca`,
    off: 'Không chặn tan ca',
    override: (r: string) => `Giám sát đã cho tan ca: ${r}`,
  },
  queue: (n: number) => `${n} ảnh đang gửi / chờ mạng`,
  bottomSummary: (approved: number, total: number) => `${approved}/${total} đã duyệt`,
  bottomDetail: (waiting: number, fix: number) => `Chờ duyệt ${waiting} · Cần sửa ${fix}`,
  checkButton: 'Kiểm tra trước tan ca',

  detail: {
    standard: 'Tiêu chuẩn đạt',
    sop: 'Hướng dẫn làm & góc chụp',
    fixNote: 'Chỉ chụp lại ô có viền đỏ. Các ô khác đã đạt, giữ nguyên.',
    waitingNote: (at: string) => `Đã gửi lúc ${at}. Đang chờ giám sát duyệt — bạn không cần làm gì thêm.`,
    approvedNote: 'Đã duyệt. Việc này không còn chặn tan ca.',
    blockedNote: (r: string) => `Đang báo vướng: ${r}. Giám sát đã nhận thông báo.`,
    declinedNote: (r: string) => `Bạn đã từ chối: ${r}`,
    offeredNote: 'Việc mới được giao. Bấm "Nhận việc" để bắt đầu.',
    reworkNote: 'Giám sát ghi chú',
    reworkPhoto: 'Xem ảnh lỗi giám sát gửi',
    history: 'Lịch sử',
    missing: (list: string) => `Còn thiếu: ${list}`,
  },

  slot: {
    tapToShoot: 'Chạm để chụp',
    sample: 'Ảnh mẫu',
    uploading: 'Đang gửi…',
    queued: 'Chờ mạng',
    failed: 'Gửi lỗi — chạm để thử lại',
    sent: 'Đã gửi ✓',
    retake: 'Chụp lại',
    generic: (i: number) => `Ảnh ${i}`,
    remove: 'Bỏ ảnh này',
  },

  evidence: {
    min: (n: number) => `tối thiểu ${n}`,
    belowMin: 'Dưới mức tối thiểu — đã báo quản lý bổ sung',
  },

  accept: {
    accept: 'Nhận việc',
    decline: 'Từ chối',
    reasonPlaceholder: 'Lý do từ chối (bắt buộc)',
    send: 'Gửi từ chối',
    cancel: 'Huỷ',
  },

  stuck: {
    open: 'Báo vướng',
    title: 'Báo vướng — chọn lý do',
    reasons: {
      NO_SUPPLY: 'Thiếu vật tư',
      ROOM_OCCUPIED: 'Phòng đang có khách',
      EQUIPMENT_BROKEN: 'Thiết bị hỏng',
      NEED_HELP: 'Cần người hỗ trợ',
      OTHER: 'Lý do khác',
    } as Record<string, string>,
    notePlaceholder: 'Ghi chú thêm (không bắt buộc)',
    send: 'Gửi báo vướng',
    cancel: 'Huỷ',
    resume: 'Đã xử lý xong, làm tiếp',
  },

  sheet: {
    title: 'Kiểm tra trước tan ca',
    allGood: 'Mọi việc bắt buộc đã được duyệt. Bạn có thể tan ca ở màn Chấm công.',
    intro: 'Chỉ tan ca được khi mọi việc bắt buộc đã được duyệt. Chạm vào việc để mở.',
    mustDo: 'Bạn cần làm',
    mustFix: 'Bạn cần sửa',
    waitReview: 'Chờ giám sát duyệt',
    yours: 'phần của bạn',
    supervisors: 'phần của giám sát, không tính lỗi bạn',
    goAttendance: 'Mở màn Chấm công',
    close: 'Đóng',
    suddenOff: 'Báo off đột xuất không bị chặn bởi việc chưa duyệt.',
  },

  events: {
    ASSIGNED: 'Được giao việc',
    ACCEPTED: 'Đã nhận việc',
    DECLINED: 'Đã từ chối',
    PHOTO: 'Đã gửi ảnh',
    PHOTO_REMOVED: 'Đã bỏ 1 ảnh',
    EVIDENCE: 'Đã cập nhật số liệu',
    SUBMITTED: 'Đủ bằng chứng, gửi duyệt',
    APPROVED: 'Giám sát đã duyệt',
    RETURNED: 'Giám sát trả lại',
    BLOCKED: 'Báo vướng',
    UNBLOCKED: 'Hết vướng, làm tiếp',
    WAIVED: 'Giám sát miễn hôm nay',
    CANCELLED: 'Việc đã huỷ',
  } as Record<string, string>,

  toast: {
    submitted: 'Đủ bằng chứng — đã gửi giám sát duyệt',
    queued: 'Mất mạng: ảnh lưu trên máy, sẽ tự gửi khi có mạng',
    online: 'Có mạng lại — đang gửi ảnh trong hàng chờ',
    tooDark: 'Ảnh quá tối, chụp lại ở chỗ đủ sáng.',
    accepted: 'Đã nhận việc',
    declined: 'Đã từ chối, việc quay về người giao',
    stuckSent: 'Đã báo giám sát',
    error: 'Có lỗi, thử lại sau ít phút.',
  },
};
