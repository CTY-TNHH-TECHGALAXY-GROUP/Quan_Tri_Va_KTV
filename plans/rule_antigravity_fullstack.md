# Antigravity Rule

## Mục đích

Rule này dùng để chặn kiểu sửa bị “rơi trọng lực” về vá tạm, vá một điểm, hoặc chỉ làm đẹp UI mà không sửa gốc.

Nguyên tắc:

**Một thay đổi nghiệp vụ không được phép dừng ở một layer. Phải truy đến contract gốc và sửa end-to-end.**

---

## Prompt antigravity

```text
Áp dụng ANTIGRAVITY MODE.

Không được vá tạm. Không được fix riêng UI. Không được kết luận xong nếu chưa đi hết flow.

Với mọi thay đổi liên quan đến trạng thái, dữ liệu, điều phối, booking, thanh toán, phân quyền, đồng bộ hoặc dashboard:

1. Tìm source of truth thật sự.
2. Kiểm tra toàn bộ đường đi end-to-end:
   - UI
   - page/container logic
   - server actions
   - API/RPC
   - DB/schema/migration
   - realtime/refetch/subscription
   - worker/cron/auto-update
   - helper mapping chung
   - test/checklist verify
3. Tìm mọi alias cũ, enum cũ, mapping cũ, fallback cũ, recompute rải rác.
4. Nếu nhiều nơi cùng định nghĩa logic, phải gom về contract chung thay vì vá từng chỗ.
5. Backend không được tin payload nếu chưa kiểm tra current state.
6. Realtime phải dùng cùng mapping với initial fetch.
7. Worker/auto-job không được phép ghi đè ngược thao tác tay.
8. Phải kiểm tra stale data, reload, refetch, race condition, backward transition, partial update.
9. Nếu còn legacy compatibility, phải nói rõ đó là alias tạm hay raw source thật.
10. Chỉ được gọi là done khi:
   - frontend đúng
   - backend chặn sai contract
   - DB không còn bị ghi lệch flow
   - realtime không kéo ngược dữ liệu
   - worker không phá trạng thái mới
   - có cách verify end-to-end

Output bắt buộc:
- Source of truth là gì
- Các layer bị ảnh hưởng
- Đã sửa tận gốc ở đâu
- Chỗ nào còn risk
- Cách verify thật
```

---

## Team rule ngắn

```text
Không fix một màn hình.
Không fix một API.
Không fix một bug theo triệu chứng.

Phải fix cả contract.
Phải kiểm tra cả frontend, backend, DB, realtime, worker.
Phải verify lại end-to-end.

Nếu chưa chặn được dữ liệu sai ở backend thì chưa được xem là xong.
Nếu reload/refetch/realtime còn có thể lệch thì chưa được xem là xong.
Nếu còn alias cũ sống như raw source thì chưa được xem là xong.
```

---

## Câu nhắc 1 dòng

```text
Hãy sửa thay đổi này theo antigravity rule: truy tới contract gốc, rà đủ mọi layer, loại bỏ vá tạm, và chỉ chốt khi flow end-to-end thật sự ổn định.
```
