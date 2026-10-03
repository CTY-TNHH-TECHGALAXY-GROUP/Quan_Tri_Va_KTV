# Kế hoạch tách nhỏ `app/reception/dispatch/page.tsx`

**Ngày lập:** 05/09/2026 · **Cập nhật:** 05/09/2026
**Nhánh:** `feat/bit-lo-hong-phase1`
**Trạng thái:** ✅ **Đợt 1 XONG** · Đợt 2–4 chưa làm.
**Tiền lệ:** KTV Dashboard đã tách xong ở `1b1d70f` + `f820f3b` (2549 → 184 dòng, nạp trang 7,16s → 0,44s).

---

## 0. Tình hình hiện tại

| | Dòng | Ghi chú |
|---|---|---|
| Ban đầu | 3983 | một hàm duy nhất |
| **Sau Đợt 1** | **3120** | −863 dòng (−22%), gỡ 3 state (47 → 44 hook) |
| Mục tiêu sau Đợt 4 | ~900 | |

**Commit của Đợt 1:** `8fa5357` → `c501a41` → `3f65933` → `60455a5` → `d083c23`

### Chín component đã tách (`_components/`)

| File | Props |
|---|---|
| `ConfirmActionModal.tsx` | `open`, `message`, `onConfirm`, `onCancel` |
| `PhotoViewerModal.tsx` | giữ nguyên tên biến (làm trước khi chốt hướng đặt lại props) |
| `QrJourneyModal.tsx` | `data`, `onClose` — nuốt luôn `JOURNEY_BASE_URL`, `QR_SIZE` |
| `StartServiceModal.tsx` | `open`, `selectedDate`, `onConfirm`, `onClose` |
| `InvoiceLanguageModal.tsx` | `invoiceId`, `onClose` |
| `AddServiceModal.tsx` | 9 props; ô tìm kiếm thành state nội bộ |
| `DispatchConfirmModal.tsx` | `open`, `order`, `subOrder`, `rooms`, `beds`, `onConfirm`, `onClose` |
| `SplitDurationModal.tsx` | `config`, `onChange`, `onConfirm`, `onCancel` |
| `OrderContextMenu.tsx` | `menu`, `orders`, `subOrders`, `onClose`, `actions` (gom 8 handler) |

Kèm 2 file helper dùng chung: `dispatch-display.ts` (`getDisplayCustomerName`) và bổ sung `formatToHourMinute` vào `dispatch-time.logic.ts`.

### Phát hiện khi đọc kỹ từng khối

- **🐞 Lỗi thật đã sửa:** `mergePromptConfig` render **hai lần** — một bản JSX inline trong `page.tsx` và một lần nữa qua `<MergePromptModal>` đã tách sẵn, cùng điều kiện `config != null`. Mỗi lần quầy gán một KTV cho nhiều dịch vụ là **hai hộp thoại chồng lên nhau**. Bản inline là code sót lại, đã xoá.
- **3 state đặt nhầm chỗ** — chỉ modal đọc, không caller nào ngoài dùng: `svcSearchQuery`, `customStartInputValue`, `showQrForLang`. Đã chuyển vào component, kéo theo 3 dòng `setSvcSearchQuery('')` rải rác và 1 dòng set giờ trước khi mở modal.
- **Biến chết** `nameStr` (gán rồi không đọc, 2 chỗ).
- **Code lặp**: logic "thiếu KTV" viết 2 lần; hàm lấy tên dịch vụ đa ngôn ngữ viết 2 lần.

### Bài học công cụ

- **Không cắt theo số dòng.** Lần đầu làm vậy ở KTV Dashboard đã hỏng file (9 lỗi JSX, phải `git restore`). Dùng công cụ cắt theo tên hàm + cân bằng ngoặc, bỏ qua ngoặc nằm trong chuỗi/comment.
- Với `function X({...})`, phải bỏ qua cặp ngoặc tròn của tham số trước rồi mới tìm `{` thân hàm — nếu không sẽ dừng ở `{` của destructuring.
- Sau mỗi lần tách: `tsc --noEmit` rồi **thao tác thật trên trình duyệt**, không chỉ tin `tsc`.

---

## 1. Vì sao phải tách

File **207KB / 3983 dòng**, và toàn bộ nằm trong **một hàm duy nhất** `DispatchBoardPage`.

Hệ quả đo được:
- Next dev biên dịch lại 7–20 giây mỗi lần sửa, vượt timeout 15s của `apiClient` → UI báo *"Kết nối bị quá hạn"*
- Sửa một nút nhỏ cũng phải nạp lại cả file trong đầu
- Chạm vào file là đụng mọi thứ — rủi ro hồi quy cao trên màn quầy dùng hằng ngày

Khác với KTV Dashboard (mỗi màn đã là một `function` riêng, tách rất gọn), file này **không có ranh giới sẵn**. Phải bóc từng khối JSX ra khỏi closure của component cha.

---

## 2. Cấu trúc hiện tại

```
dòng    1 – 1944   state + handler   (47 hook, 13 handler lớn)
dòng 1945 – 3983   một khối JSX return duy nhất
```

Chi tiết khối JSX:

| Khối | Dòng | Số dòng | Độ khó tách |
|---|---|---|---|
| Header | 1945–2126 | 182 | Trung bình |
| LEFT: Order Panel | 2127–2330 | 204 | Khó |
| CENTER: Assignment Panel | 2331–2966 | **636** | Khó nhất |
| Add Svc Modal | 2967–3070 | 104 | Dễ |
| Dispatch Confirmation Modal | 3071–3213 | 143 | Dễ |
| Context Menu Cancellation | 3214–3370 | 157 | Dễ |
| QR Journey Modal | 3371–3429 | 59 | Dễ |
| Split Service Modal | 3430–3597 | 168 | Dễ |
| Modal Xem Ảnh | 3598–3702 | 105 | Dễ |
| Modal Tạm Dừng / Đổi KTV | 3703–3728 | 26 | Dễ (đã là component ngoài) |
| Custom Confirm Modal | 3729–3767 | 39 | Dễ |
| Custom Start Service Modal | 3768–3838 | 71 | Dễ |
| Invoice Language Modal | 3839–3982 | 144 | Dễ |

Thư mục `_components/` đã có sẵn 13 file (KanbanBoard, QuickDispatchTable, AddOrderModal…) — nghĩa là dự án đã theo hướng này, chỉ là làm dở.

---

## 3. Nguyên tắc

1. **Không đổi hành vi.** Chỉ di chuyển code, không sửa logic. Mọi khác biệt nghiệp vụ phải là một commit riêng.
2. **Tách từ dễ đến khó**, commit sau mỗi bước, `tsc` sạch mới đi tiếp.
3. **Modal trước, panel sau.** Modal chỉ đọc vài state và gọi vài handler → truyền qua props là xong. Panel bám sâu vào closure.
4. **Kiểm chứng trên trình duyệt sau mỗi đợt**, không chỉ dựa vào `tsc` — đây là màn quầy đang chạy thật.
5. Dùng lại công cụ cắt theo tên hàm + cân bằng ngoặc đã viết cho KTV Dashboard (bỏ qua ngoặc trong chuỗi/comment). **Không cắt theo số dòng** — lần đầu làm vậy ở dashboard đã hỏng file.

---

## 4. Các đợt

### ✅ Đợt 1 — 9 modal · rủi ro thấp · **ĐÃ XONG** (xem mục 0)

Bóc từng modal thành component nhận props rõ ràng, đặt trong `_components/`:

| File mới | Từ khối |
|---|---|
| `AddServiceModal.tsx` | Add Svc Modal |
| `DispatchConfirmModal.tsx` | Dispatch Confirmation Modal |
| `OrderContextMenu.tsx` | Context Menu Cancellation |
| `QrJourneyModal.tsx` | QR Journey Modal |
| `SplitServiceModal.tsx` | Split Service Modal |
| `PhotoViewerModal.tsx` | Modal Xem Ảnh |
| `ConfirmModal.tsx` | Custom Confirm Modal |
| `StartServiceModal.tsx` | Custom Start Service Modal |
| `InvoiceLanguageModal.tsx` | Invoice Language Modal |

Cách làm cho mỗi modal: liệt kê state/handler nó dùng → thành props → thay khối trong `page.tsx` bằng `<XModal ... />`.

→ **Thực tế: page.tsx còn 3120 dòng.**

### ⏳ Đợt 2 — Header (182 dòng) · rủi ro trung bình

Tách `DispatchHeader.tsx`: chọn ngày, bộ đếm, nút chuyển chế độ mobile. Chủ yếu đọc state, ít ghi.

→ **page.tsx còn ≈2780 dòng.**

### ⏳ Đợt 3 — Hai panel (840 dòng) · rủi ro cao

- `OrderPanel.tsx` (204 dòng) — danh sách đơn chờ
- `AssignmentPanel.tsx` (636 dòng) — khối gán KTV, dày state nhất

Bước này cần khoanh vùng state trước: state nào chỉ panel dùng thì **đẩy hẳn vào panel**, state nào chia sẻ thì giữ ở cha và truyền xuống. Làm ẩu ở đây sẽ đẻ ra prop drilling 20 tham số.

→ **page.tsx còn ≈1940 dòng.**

### ⏳ Đợt 4 — Handler (≈1000 dòng) · rủi ro cao

13 handler lớn (`handleDispatch` 305 dòng, `handleSaveDraft` 162 dòng, `handleUpdateStatus` 152 dòng…) chuyển vào `useDispatchBoard.logic.ts` đang có sẵn, hoặc tách `useDispatchActions.ts` riêng.

→ **page.tsx còn ≈900 dòng** — chấp nhận được cho một màn phức tạp cỡ này.

---

## 5. Rủi ro

- **Đây là màn quầy dùng hằng ngày.** Hỏng là chặn vận hành ngay. Cần kiểm thử thủ công luồng điều phối sau mỗi đợt, không chỉ `tsc`.
- **File đang có thay đổi chưa commit** từ phiên song song (`M app/reception/dispatch/page.tsx` trong git status đầu phiên). Phải commit hoặc stash sạch trước khi bắt đầu, nếu không sẽ lẫn.
- **Dev server hay hỏng** khi có nhiều tiến trình cùng chạy. Chỉ để một `npm run dev`.
- `handleDispatch` (305 dòng) có nhiều nhánh `skipValidation` / `specificSvcIds` / `precomputedSplitPlan` — đụng vào phải rất cẩn thận, để cuối cùng.

---

## 6. Làm tiếp thế nào

Đợt 1 đã chứng minh cách chia props chạy được. Hai đợt còn lại khác hẳn về bản chất — modal chỉ *nhận* dữ liệu, còn panel và handler *sở hữu* state đang chạy thật.

**Trước khi bắt đầu Đợt 2:**
1. Dọn sạch git — hiện `actions.ts` và `useDispatchBoard.logic.ts` vẫn còn thay đổi chưa commit của phiên song song. Commit hoặc stash trước, nếu không sẽ lẫn.
2. Chỉ để **một** tiến trình `npm run dev`. Nhiều server cùng ghi `.next` gây `UnrecognizedActionError` và hỏng cache webpack.

**Đợt 3 và 4 nên là phiên làm việc riêng.** Chúng đụng vào state và handler của luồng điều phối đang chạy hằng ngày; cần thời gian đi hết một vòng nghiệp vụ thật (tạo đơn → gán KTV → gửi → tạm dừng → đổi KTV → hoàn tất) chứ không chỉ mở trang xem có render không.

**Thứ tự đề xuất cho Đợt 3** (khó nhất): khoanh vùng state trước khi cắt. Với mỗi state trong `AssignmentPanel`, trả lời "ai ngoài panel này đọc nó?" — không ai thì đẩy hẳn vào panel (như đã làm với `svcSearchQuery` ở Đợt 1). Chỉ những state thật sự chia sẻ mới giữ ở cha. Bỏ qua bước này sẽ đẻ ra một component 20 tham số, còn khó đọc hơn lúc chưa tách.
