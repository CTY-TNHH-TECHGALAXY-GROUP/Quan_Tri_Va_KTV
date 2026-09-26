# Plan sửa gấp 6 lỗi nối tiếp A/B

> Nghiệm thu bổ sung: `sequential_acceptance_results_20260926.md`. Giới hạn FINISH ghi từng item ở plan ban đầu đã được thay bằng RPC giao dịch sau khi nghiệm thu xác nhận rủi ro lưu một phần. Plan này giữ lại quyết định ở thời điểm ban đầu.

## Phạm vi
- Branch: `feat/sequential-two-slot-handoff-20260926`, nền `f206bfb8`.
- Diff đầy đủ đề xuất: `sequential_six_fixes_20260926.patch` (16 file nguồn).
- Bằng chứng: `sequential_operational_audit_20260926.md` và script tái hiện cùng tên.
- Đã triển khai trên branch feature bằng 4 sub-agent + tích hợp root. Kết quả: `sequential_six_fixes_results_20260926.md`; diff thực tế: `sequential_six_fixes_implemented_20260926.patch`. Diff đề xuất ban đầu được giữ để đối chiếu.
- Phê duyệt “Duyệt sửa file ổn định” đã có trong session. Không cần xin lại cho cùng phạm vi này.

## Thứ tự triển khai

### Bước 1 — Hai lỗi P1: chặng hiện hành và hoàn thành
**1. B → C → B chọn đúng lượt đang được gán**
- Thêm predicate dùng chung `isLiveKtvSegment`, tái sử dụng `ktvMatchesSeg` để giữ hỗ trợ mã nhân viên ghép và không phân biệt hoa/thường.
- API GET/START/FINISH và logic timer dùng cùng tập segment không voided. Không chỉ sửa riêng màn hiển thị.
- Admin đưa segment còn hiệu lực lên trước, Kanban/Quick chọn segment hiện hành khi hiển thị giờ. Segment đã hủy giữ trong dữ liệu phục vụ lịch sử, không cộng vào thời lượng đang làm.
- Chặn mở sửa B từ thẻ B cũ đã bị thay.
- File: `lib/ktvUtils.ts`; ba handler GET/START/FINISH; `KTVDashboard.logic.ts`; Dashboard/Timer; admin loader, QuickDispatchTable, KanbanBoard.

**2. Không chuyển sang review khi hoàn thành chưa lưu được**
- FINISH kiểm lỗi đọc item, ghi item và đồng bộ item con; trả lỗi thay vì báo thành công.
- Client bắt cả lỗi HTTP/network do apiClient throw; nhả loading/transition lock và giữ màn hiện tại. Không dừng đồng hồ do một response thất bại.
- Cập nhật nhiều item vẫn là các lần ghi riêng hiện có. Nếu đã ghi một phần, tải lại dữ liệu để tiếp tục; không tự xóa timestamp đã lưu hoặc giả lập rollback.
- Không thêm RPC giao dịch mới chỉ để che lỗi này. Nếu test nhiều item cho thấy cần atomic toàn bộ lượt hoàn thành, bổ sung transaction trước nghiệm thu flow đó.

### Bước 2 — Ngày B và tên hiển thị
**3. Không lưu nhầm ngày khi giờ B qua 0h**
- Đổi inline từ 23:50 sang 00:10 phải yêu cầu ngày đầy đủ, qua khung `Sửa B` datetime hiện có.
- Server DRAFT/DISPATCH chặn thay đổi HH:mm chênh từ 12 giờ khi payload không chỉ rõ ngày; không cho confirmOverlap vượt qua guard ngày.
- ASSIGN_B datetime tiếp tục lưu timestamp có timezone đầy đủ. Demo áp cùng guard.
- Mốc 12 giờ là quy tắc chuyển sang khung chọn ngày, không tự suy đoán ngày đúng. Cả sửa lùi lớn trong cùng ngày cũng dùng datetime.
- Gate bắt buộc: tên/ghi chú B đang chỉnh không bị mất khi chuyển sang Sửa B; nếu cần, giữ/commit bản metadata đang chỉnh cùng revision trước RPC datetime.
- File: QuickDispatchTable, SequentialDemo, migration audit chưa áp dụng.

**4. Parse options nhất quán**
- Helper client-safe normalize object/chuỗi JSON tối đa hai lớp, guard malformed/null/array.
- API enrich trả options đã normalize và tên gốc `base_service_name` để khi xóa tên riêng không quay về tên riêng cũ đang cache.
- Tên riêng tra đúng mã tài khoản, hỗ trợ khác hoa/thường.

**5. Realtime cập nhật tiêu đề từ bản options mới**
- Helper `ktvServiceName` dùng chung cho GET API, raw realtime merge và Dashboard/Timer.
- Thứ tự tên: tên riêng của người đó → tên hiển thị hiện tại → tên gốc danh mục → fallback API.
- Realtime vẫn bảo vệ screen REVIEW/HANDOVER/REWARD; chỉ cập nhật dữ liệu/tên, không ép chuyển màn.
- File: ktvUtils, handleGetBooking, KTVDashboard.logic, Dashboard, Timer.

### Bước 3 — Thông báo và báo kết quả cho quầy
**6. Phân biệt lưu dữ liệu và tạo notification**
- Helper trả boolean cho kết quả INSERT, kể cả lỗi network; các caller cũ bỏ qua return vẫn tương thích.
- ASSIGN_B và DISPATCH B kiểm return và trả `warnings` nếu phân công đã lưu nhưng chưa tạo được notification.
- Page hiển thị cảnh báo này; không trả lỗi “chưa lưu” khiến quầy gửi lại payload cũ.
- Bỏ thao tác xóa tin cũ trước insert trong flow cập nhật B. Giữ tin cũ để không mất thông tin khi insert lỗi.
- Giữ lịch sử notification cũ; không thêm queue/outbox trong bản sửa gấp. Nếu cần tự retry notification không điều phối lại, làm thao tác gửi lại riêng với ID bản cập nhật đã lưu.
- Không coi INSERT thành công là push đã giao tới thiết bị. DB webhook/push phải kiểm thử tích hợp riêng.
- File: notification-helper, dispatch/actions, dispatch/page.

## Các hunk chính của diff
```diff
- ktvMatchesSeg(seg.ktvId, ktvId)
+ isLiveKtvSegment(seg, ktvId)

- const seg = st?.segments?.[0];
+ const seg = st?.segments?.find(g => !g.voided) || st?.segments?.[0];

- await supabase.from('BookingItems').update(payload).eq('id', item.id);
+ const { error } = await supabase.from('BookingItems').update(payload).eq('id', item.id);
+ if (error) return responseLoi; // client giữ màn hiện tại

- const opts = i.options || {};
+ const opts = parseKtvOptions(i.options);

- item.service_name
+ ktvServiceName(item, ktvId)

- ghép ngày B cũ với bất kỳ HH:mm mới
+ chênh >=12h: yêu cầu chọn datetime trong Sửa B, server cũng chặn

- xóa notification cũ rồi insert; lỗi chỉ log
+ giữ notification cũ; kiểm INSERT; trả warnings khi đã lưu nhưng chưa tạo tin
```
Hunk minh họa trên là bản đọc nhanh; file `.patch` chứa diff có context thực tế và code cụ thể.

## Kiểm thử bắt buộc khi triển khai
| Nhóm | Ca / tiêu chí PASS |
| --- | --- |
| Chặng B quay lại | A → B → C → B; admin/Kanban/Dashboard/Timer cùng giờ B mới; không cộng thời lượng cũ; START/FINISH nhắm đúng segment mới; lịch sử cũ còn nguyên |
| B thay nhiều lần | B → C → D, B cũ còn mở màn: không bắt đầu hoặc sửa lượt mới; A unchanged |
| Hoàn thành lỗi | Giả lập lỗi SELECT/UPDATE, lỗi item thứ hai, lỗi HTTP/network: không REVIEW giả, nhả loading, reload thấy phần đã lưu đúng; retry không mất timestamp |
| Hoàn thành bình thường | A xong chờ B; B xong mới CLEANING; manual Hoàn thành sau A đúng; flow nhiều dịch vụ không hồi quy |
| Ca đêm | 23:50 ngày 26 → 00:10 ngày 27; inline không lưu lùi ngày; Sửa B lưu ISO đúng; sửa ngược qua ngày cũng đúng |
| Metadata chưa lưu | Đổi tên/ghi chú B rồi chuyển khung ngày: giữ bản chỉnh, không quay về mặc định hoặc lỗi revision do chính lần lưu của mình |
| Options | object, JSON string, double-encoded, malformed/null; A/B tên riêng; xóa tên riêng trở về tên gốc |
| Realtime | API trả tên cũ rồi raw event trả options mới: tiêu đề đổi ngay; A không đổi; post-service screen không bị điều hướng |
| Notification lỗi | INSERT lỗi/network: phân công lưu đúng, warning hiện, tin cũ còn; chỉ B là người nhận |
| Notification thành công | Message chứa tên/giờ B mới; A không bị gửi lại; kiểm webhook/push trên DB test riêng |
| Bảo vệ bản lưu | stale revision, overlap chưa xác nhận, B đã bắt đầu, reload và sửa lần 2 tiếp tục PASS |

## Gate và bàn giao
1. Áp patch trên branch riêng, chuyển script audit từ “assert lỗi hiện tại” sang regression assertions hành vi đúng; bổ sung ca còn thiếu.
2. Chạy SQL PGlite, component/SSR, actual handlers với lỗi DB/notification giả lập, các script sequential đã có.
3. TypeScript, lint các file chạm, git diff --check. Không dùng PASS của TypeScript thay cho PASS vận hành.
4. Mở demo hai tài khoản A/B, kiểm trực quan giờ/tên/trạng thái và reload. Demo chưa migrate test được phần LocalStorage.
5. Sau các gate trên, kiểm full migration chain và flow hai tài khoản trên DB test riêng; chưa migrate DB dùng chung.
6. Commit bản sửa + kết quả test vào branch feature, chưa merge/push/deploy theo plan này.

## Xác minh diff ở bước lập plan
- `git apply --check _plans/sequential_six_fixes_20260926.patch`: PASS.
- Đọc candidate bằng TypeScript compiler host, không ghi source: PASS: 0 lỗi, gồm cả catch/finally FINISH mới đề xuất.
- Đây là diff đề xuất có thể review/apply, chưa tuyên bố 6 lỗi đã được sửa hoặc các regression gate đã PASS.

## Bổ sung khi triển khai: giữ metadata đang chỉnh qua khung ngày B
```diff
- ASSIGN_B chỉ cập nhật thời gian; tên/ghi chú còn nằm ở form chưa lưu
+ ASSIGN_B nhận metadata tên/ghi chú từ bản form hiện tại
+ RPC khóa/version-check hiện có lưu datetime và metadata trong cùng transaction
+ overlap chưa xác nhận hoặc stale revision không lưu phần nào
```
Chỉ nhận hai map `serviceNamesForKtvs`, `notesForKtvs`; không nhận status/history/actual timestamps qua metadata. Ngày B chọn trực tiếp ở datetime, không tự đoán ngày sau khi đổi HH:mm.

```diff
- admin loader/page có parser options riêng chỉ đọc một lớp JSON
+ admin và nhân viên cùng dùng parseKtvOptions; xóa hai parser trùng
```
