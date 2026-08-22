# Prompt Fullstack Fix Triệt Để

## Mục tiêu

Dùng prompt/rule này mỗi khi sửa một thay đổi có thể ảnh hưởng tới nhiều lớp hệ thống, để tránh kiểu:
- chỉ sửa UI nhưng backend vẫn sai contract
- chỉ sửa backend nhưng realtime/refetch kéo dữ liệu về sai
- vá một bug nhìn thấy trước mắt nhưng bỏ sót worker, cron, RPC, API, DB, mobile/web khác
- fix xong vẫn còn race condition, trạng thái cũ, alias cũ hoặc logic duplicate ở nơi khác

---

## Rule bắt buộc

Khi làm bất kỳ thay đổi nào liên quan tới flow nghiệp vụ, trạng thái, dữ liệu, phân quyền, đồng bộ, in phiếu, thanh toán, điều phối, booking hoặc dashboard:

1. Không được vá riêng một điểm UI nếu chưa kiểm tra đường đi dữ liệu end-to-end.
2. Phải xác định rõ source of truth của dữ liệu hoặc state machine nằm ở đâu.
3. Phải rà cả nơi đọc, nơi ghi, nơi patch realtime, nơi recompute, nơi auto-update và nơi hiển thị.
4. Phải tìm và liệt kê tất cả alias cũ, mapping cũ, fallback cũ, logic copy-paste cũ.
5. Phải kiểm tra cả frontend, backend, API/RPC, DB/migration, worker/cron/auto-job, realtime/subscription và test.
6. Nếu phát hiện contract đang bị định nghĩa ở nhiều nơi, ưu tiên gom về helper hoặc module chung trước khi fix bug lẻ.
7. Không kết luận “đã xong” nếu chưa kiểm tra backward move, stale data, refetch, reload, race condition và trường hợp partial update.
8. Nếu còn legacy status hoặc legacy field chưa bỏ được ngay, phải ghi rõ nó đang là alias tạm thời hay vẫn là raw source thật.
9. Mọi thay đổi phải có tiêu chí hoàn thành cụ thể, có thể kiểm được.
10. Nếu chưa sửa triệt để được trong một lượt, phải chỉ rõ phần nào đã fix thật, phần nào mới là mitigation tạm.

---

## Prompt dùng cho Codex / AI

```text
Hãy xử lý thay đổi này theo hướng fullstack triệt để, không vá tạm.

Yêu cầu bắt buộc:
1. Đọc và hiểu flow nghiệp vụ end-to-end trước khi sửa.
2. Xác định source of truth cho state/data/contract.
3. Rà toàn bộ nơi có thể bị ảnh hưởng:
   - frontend UI
   - page/container logic
   - server actions
   - API / RPC
   - DB schema / migration
   - realtime subscription / patching / refetch
   - worker / cron / auto-update / background job
   - helper dùng chung / mapping / enum / status flow
   - test hiện có và test còn thiếu
4. Chỉ ra chỗ nào đang duplicate logic, alias cũ, fallback cũ, status cũ hoặc recompute rải rác.
5. Không chỉ sửa triệu chứng; phải sửa theo contract chung.
6. Nếu có risk race condition, stale data, backward transition, partial update hoặc mismatch UI-DB thì phải xử lý hoặc nêu rõ blocker.
7. Khi review hoặc sửa xong, trả kết quả theo format:
   - Phạm vi ảnh hưởng
   - Những gì đã sửa
   - Những chỗ còn lệch contract
   - Risk còn lại
   - Cách verify end-to-end

Definition of done:
- UI hiển thị đúng
- backend chặn sai contract
- realtime/refetch không kéo dữ liệu về sai
- worker/auto-job không ghi đè ngược
- không còn alias cũ làm raw source ngoài ý muốn
- có ít nhất một checklist hoặc test matrix để verify
```

---

## Checklist review trước khi merge

### 1. Contract
- Raw status/field chuẩn là gì?
- Alias nào chỉ được dùng để tương thích tạm?
- Có chỗ nào đang tự suy diễn khác contract chung không?

### 2. Nơi ghi dữ liệu
- UI gửi gì?
- Server action nhận gì?
- API/RPC có validate forward-only hoặc validate enum không?
- DB có bị ghi trực tiếp từ payload mà không check current state không?

### 3. Nơi đọc dữ liệu
- UI mapping raw data sang display state ở đâu?
- Realtime patch có dùng cùng helper với initial fetch không?
- Refetch xong có thể nhảy cột hoặc nhảy trạng thái không?

### 4. Tự động hóa
- Có worker, cron, timer, auto-finish, background sync nào cũng ghi vào cùng field không?
- Nếu có nhiều nguồn ghi, đã chốt 1 nguồn chính chưa?
- Có khả năng vừa bấm tay xong thì worker kéo ngược lại không?

### 5. Race condition
- Hai request song song có thể tạo trạng thái mâu thuẫn không?
- Có cần unique index, row lock, transaction hoặc optimistic guard không?
- Nếu request cũ tới sau request mới thì có ghi đè sai không?

### 6. Tương thích dữ liệu cũ
- DB hiện còn dữ liệu legacy không?
- Nếu còn, đã normalize hay self-heal đúng chưa?
- Logic cleanup có vô tình coi state đang hoạt động là state đã xong không?

### 7. Verification
- Reload trang có giữ đúng trạng thái không?
- Realtime đến ngay sau update có đúng không?
- Case partial item / multi-item / multi-staff có đúng không?
- Case terminal state có bị kéo lùi không?

---

## Rule viết code

1. Một flow nghiệp vụ chỉ nên có một helper trạng thái trung tâm.
2. Frontend không tự bịa status mới nếu backend không hiểu.
3. Backend không tin payload từ client nếu chưa check current state.
4. Realtime patch phải dùng cùng mapping với initial load.
5. Worker và thao tác tay phải dùng cùng contract.
6. Mọi legacy alias phải được normalize rõ ràng ở boundary.
7. Nếu một fix cần migration, phải review luôn code path đang đọc/ghi field đó.

---

## Mẫu yêu cầu ngắn gọn cho team

```text
Đừng fix riêng UI hoặc riêng backend.
Hãy coi thay đổi này là thay đổi fullstack.
Kiểm tra đủ frontend, backend, API/RPC, DB, realtime, worker và test.
Chỉ merge khi contract thống nhất, không còn logic duplicate nguy hiểm, không còn stale/revert/race dễ thấy, và có cách verify end-to-end.
```

---

## Khi nào phải bật chế độ “điều tra fullstack”

Bật rule này ngay nếu có một trong các dấu hiệu sau:
- Bấm xong rồi reload lại bị sai
- UI đúng lúc đầu nhưng refetch/realtime lại nhảy sai
- Có nhiều tên trạng thái cho cùng một bước
- Một bug lặp lại dù đã fix trước đó
- Có nhiều nơi cùng update một field
- Một phần hệ thống dùng enum mới, phần khác vẫn dùng enum cũ
- KTV, lễ tân, admin hoặc mobile/web nhìn cùng dữ liệu nhưng ra kết quả khác nhau

---

## Kết luận

Nguyên tắc cốt lõi là:

**Không fix một màn hình. Phải fix cả contract của flow.**

Nếu contract chưa thống nhất thì bug sẽ chỉ đổi chỗ, không biến mất.
