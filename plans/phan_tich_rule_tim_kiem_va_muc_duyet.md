# Phân tích: Rule "Tìm kiếm" và "Mức duyệt" (chốt 2026-09-11)

> Kết quả đã áp dụng vào `CLAUDE.md` (mục 2 và mục 3), bản sao ở `.gemini/rules.md`.

## Bối cảnh
Kiểm tra bộ rule cũ thấy nhiều chỗ tự mâu thuẫn. Hai chỗ lớn nhất:
- **#1**: "NO AUTO SEARCHING" (cấm grep) ↔ Planner phải "khảo sát codebase", phải "đọc header handler".
- **#4**: "Plan first, chờ duyệt" ↔ "Vibe Code, code thẳng vào codebase".

---

## #1 — Tìm kiếm

### Lý do rule cũ tồn tại (suy đoán)
Với Antigravity, grep gây: popup "Allow running this command", quét cả `node_modules`/`.next` làm đầy context, AI quét lan man tốn thời gian.

### Rủi ro khi cấm hẳn
- `KtvAssignments` / `allSegsDone` xuất hiện ở **13 file** (route KTV, dispatch, service, handler). Đổi cột hoặc response mà không tìm chỗ gọi → sửa 1 file, hỏng 12 file còn lại mà không báo lỗi gì.
- Lỗi comment timer "PREV-1" ngược rule chỉ phát hiện được nhờ grep.
- Hệ thống tính tiền/tua/hoa hồng → sửa sót = mất tiền thật.

### Công cụ khác → bối cảnh khác
Claude Code: Grep/Glob là tool chỉ đọc, không bật popup, tự bỏ qua thư mục trong `.gitignore`, có thể chỉ trả số lượng/tên file.

### Phương án
| | Ưu | Nhược |
|---|---|---|
| A. Giữ cấm | Nhanh, ít popup | AI đoán, sửa sót chỗ gọi |
| B. Tìm có mục tiêu | An toàn, gọn | Cần định nghĩa rõ |
| **C. B + agent phụ cho khảo sát rộng** ✅ | Cửa sổ chính gọn, khớp mô hình Planner/Executor | Tốn token hơn khi khảo sát lớn |

**Chốt: C.** Được tìm theo tên cụ thể; bắt buộc impact check trước khi đổi thứ dùng chung; cấm tìm mơ hồ và đọc `node_modules`/`.next`; khảo sát rộng giao agent phụ.

---

## #4 — Mức duyệt

### Nhận định
Hai rule đều đúng, nhưng cho **loại việc khác nhau**. Git log gần đây toàn fix nhỏ (tiêu đề email, dịch chữ, đơn vị VND): chờ duyệt những việc này là thừa. Ngược lại, 1 dòng sửa công thức hoa hồng thì bắt buộc phải có người xem.

### Chốt: 3 mức, xét theo KHU VỰC chứ không theo số dòng
| Mức | Loại việc | Cách làm |
|---|---|---|
| 0 — Làm luôn | Chữ, i18n, CSS nhỏ, bug rõ trong 1–2 file, không chạm Mức 2 | Nêu nguyên nhân → sửa → báo |
| 1 — Plan ngắn | Nhiều file, trang/component mới, đổi luồng, đổi API | Plan 5–10 dòng, chờ OK |
| 2 — Plan file | DB/migration, tiền/tua/hoa hồng/ví, KTV Dashboard lõi, Dispatch, auth, xóa dữ liệu — dù 1 dòng | `plans/plan_*.md`, chờ duyệt, test edge case |

Quy tắc kèm: ghi nhãn mức ở đầu câu trả lời; không chắc → xếp lên; "làm luôn" chỉ bỏ chờ cho Mức 0–1.

### Điểm yếu & giảm thiểu
AI tự xếp mức có thể sai → liệt kê khu vực Mức 2 bằng **đường dẫn file cụ thể** trong `CLAUDE.md`. Nếu cần chặt hơn: thêm hook Claude Code tự hỏi lại mỗi khi sửa file Mức 2 (do máy thực thi, không phụ thuộc AI nhớ rule) — **chưa làm, chờ user quyết**.

---

## Các mâu thuẫn khác đã chốt cùng đợt
| # | Mâu thuẫn | Chốt |
|---|---|---|
| 2 | Commit tiếng Anh ↔ tiếng Việt | Tiếng Việt không dấu (theo git log thực tế) |
| 3 | Mô phỏng "bắt buộc bỏ qua" ↔ Dispatch bắt buộc test | Dispatch + tính tiền luôn mô phỏng; còn lại tùy rủi ro |
| 5 | Coordination optional ↔ "always check" | Chỉ khi nhiều cửa sổ làm tính năng lớn song song |
| 6 | Lưu plan "một file" ↔ `plans/` | Luôn `plans/` |
| 7 | Mọi phân tích phải lưu file | Chỉ lưu khi user đã chốt hướng hoặc yêu cầu |

Ngoài ra: bỏ khối `AGENTS.md` của thư viện agent-skills (không phải rule dự án); sửa đường dẫn `TableInSupabase.md` (trước trỏ sai sang `_V2`); bổ sung bảng `KtvAssignments` vào `TableInSupabase.md`; gộp các mục lặp.
