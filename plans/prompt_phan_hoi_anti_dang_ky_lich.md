# Prompt — Phản hồi kế hoạch Đăng ký lịch & Báo trễ

> Copy toàn bộ phần dưới gửi cho anti.

---

Kế hoạch này **tốt hơn bản trước rõ rệt**. Nhưng chưa code được ngay — có 1 chỗ trái chỉ đạo, 1 chỗ mô tả sai hệ thống, và 4 câu chưa trả lời.

Plan chuẩn đã được lưu sẵn tại **`plans/plan_type_d_bao_vang_bao_tre.md`** — đọc file đó, đừng tạo file mới.

---

## ✅ Điểm làm rất tốt: ô "Giờ sẽ có mặt" khi đăng ký

Đây là ý hay nhất trong kế hoạch, và nó **gỡ được một bế tắc thật**.

Vấn đề: ca `FREE` chiếm đa số trên production (140 / 380 bản ghi `KTVShifts`), mà `FREE` được định nghĩa là `00:00 – 23:59` (`app/api/ktv/shift/route.ts:6`). Với ca đó thì **không tồn tại mốc giờ vào ca** để tính trễ.

Cho KTV **tự khai giờ đến lúc đăng ký** thì mốc tính trễ là cam kết của chính họ, không phụ thuộc loại ca. Giữ nguyên thiết kế này.

`/ktv/schedule` cũng có thật (574 dòng `page.tsx` + 277 dòng logic) — đặt khối đăng ký vào đó là đúng, không cần dựng trang mới.

---

## 🔴 Sai chỉ đạo: vị trí và hình thức nút

Chủ dự án đã chốt khác với thiết kế của bạn:

| | Chủ dự án chốt | Bạn thiết kế |
|---|---|---|
| Vị trí | Màn chấm công **`/ktv/attendance`** | Dashboard |
| Hình thức | **1 nút "Điều chỉnh"** | 2 nút riêng |
| Sau 07:00 | **Không còn báo vắng** — chặn cứng | Vẫn cho bấm, chỉ cảnh báo −10h |

Dòng thứ ba là khác biệt **nghiệp vụ**, không chỉ giao diện. Chủ dự án muốn chặn cứng: sau 07:00 chỉ còn đường báo trễ.

Thiết kế đúng:

```
Màn /ktv/attendance, khi staff.work_type === 'TYPE_D':
  • Hiển thị giờ đăng ký đi làm hôm nay
  • Một nút [Điều chỉnh]

  Bấm trước 07:00  →  hiện 2 lựa chọn: Báo vắng | Báo trễ (nhập giờ đến)
  Bấm từ 07:00     →  chỉ còn: Báo trễ (bắt buộc nhập giờ đến)
```

Sau 07:00 mà muốn nghỉ hẳn thì không có đường bấm — hoặc báo trễ rồi không đến, hoặc im lặng; cả hai đều rơi vào chốt chặn cuối ngày, chịu −10h. Kết quả tiền như nhau, nhưng KTV không "xin nghỉ" muộn được.

File cần sửa: `app/ktv/attendance/page.tsx` (1000 dòng) và `Attendance.logic.ts` (401 dòng). **Chỉ thêm nhánh TYPE_D, không đụng luồng A/B/C.**

---

## 🔴 Mô tả sai luồng điểm danh

Bạn viết: *"Lúc KTV đến tiệm và **Lễ tân thực hiện Điểm Danh**"*.

Thực tế: **KTV tự điểm danh bằng cách kết nối wifi tiệm rồi chụp ảnh.** Lễ tân không bấm hộ.

Chốt chặn nằm ở kiểm tra IP wifi (`app/api/ktv/attendance/route.ts:70-90`):

```
1. Đọc dải IP tiệm từ SystemConfigs key 'spa_wifi_ips'
2. So 2 octet đầu của IP máy KTV với dải cho phép
3. Không khớp → từ chối + ghi SecurityAuditLogs (event_type = 'INVALID_WIFI_IP')
```

Cột `latitude`/`longitude` có trong bảng nhưng không dùng để chặn.

**Hệ quả tốt:** KTV không thể điểm danh từ xa, nên mốc giờ check-in đáng tin cậy để tính trễ.

**Hệ quả bạn phải xử lý — dùng mốc nào?**

| Mốc | Kết luận |
|---|---|
| `createdAt` — lúc KTV bấm gửi (đã qua kiểm wifi, tức đã có mặt) | ✅ **DÙNG CÁI NÀY** |
| `confirmedAt` — lúc admin duyệt | ❌ KTV đến đúng giờ mà admin duyệt trễ 30 phút là **phạt oan −5h** |

Kế hoạch của bạn chưa nhắc tới điểm này. Ghi rõ vào code và vào test.

---

## 🟡 Bảng thiếu một cột

`KTVDailyRegistration` của bạn thiếu **`penalty_applied`** — lưu mã phạt đã áp cho ngày đó.

Không có cột này thì cron chốt chặn cuối ngày sẽ ghi phạt **trùng** với phạt đã ghi lúc check-in. Ví dụ: KTV check-in trễ → đã bị −5h; đến 23:59 cron quét lại → có thể ghi thêm lần nữa.

Xem cấu trúc đầy đủ ở mục 7 của `plan_type_d_bao_vang_bao_tre.md`.

---

## 🟡 Bốn câu chưa trả lời

Mục 10 của plan có 5 câu, bạn mới giải quyết 1 (mốc giờ, bằng ô `expected_time`). Còn lại:

1. **Tái dùng `SUDDEN_OFF` và `LATE_CHECKIN` sẵn có, hay xây mới?** Hai loại này **đã tồn tại và đang chạy thật** trong `KTVAttendance` (13 bản ghi `SUDDEN_OFF`). Nếu xây luồng mới song song thì hệ thống có hai cơ chế cho cùng một việc. Đọc code rồi báo lại đánh giá.
2. **KTV không đăng ký gì cả thì tính sao?** Nghỉ có phép (bỏ qua), hay vẫn coi bỏ lịch? — quyết định cron quét ai.
3. **Đăng ký rồi có huỷ được không?** Nếu được thì huỷ trước 00:00 hay 07:00, có phạt không?
4. **Bản ghi check-in bị admin TỪ CHỐI thì tính sao?** Có `createdAt` đúng giờ nhưng `status = REJECTED`. Coi như đã có mặt, hay coi như chưa điểm danh (→ cron phạt −10h bỏ lịch)? Chênh lệch 10 giờ nên cần chốt.

**Hỏi chủ dự án câu 2, 3, 4. Câu 1 tự điều tra code rồi báo cáo.**

---

## 🔴 Chưa được code Phase 6

Hai lý do:

**Phase 5 chưa khép.** Còn 3 việc trong `prompt_type_d_phase5_dot3.md`:
- Sửa `Kỷ luật trễ giờ` → `Kỷ luật **trừ** giờ tích lũy` (dòng 178, 185) — vẫn chưa làm
- Nghiệm thu qua giao diện thật (bảng UI ↔ key ↔ giá trị) — vẫn chưa làm
- Commit `b666719` đã **quay ngược nhãn** về bản không có mốc giờ: `"Bỏ lịch đã đăng ký (không báo/báo trễ)"` mất thông tin 07:00. Khôi phục lại thành `"Bỏ lịch / báo trễ (từ 07:00)"` và `"Báo vắng hoặc trễ (trước 06:59)"`.

**Phần này không phải Phase 6.** Nó là hệ thống con mới, đánh số **Phase 5.5**, làm **trước** Phase 6 — vì thiếu nó thì `KtvTypeDDisciplineService` không có dữ liệu đầu vào, và giờ tích lũy dùng xếp tua ở Phase 6 sẽ thiếu vế trừ giờ.

---

## Thứ tự

1. Khép Phase 5 (3 việc trên)
2. Trả lời 4 câu hỏi
3. Chờ duyệt rồi mới code Phase 5.5

Không tạo file plan mới — cập nhật vào `plans/plan_type_d_bao_vang_bao_tre.md` nếu cần.
