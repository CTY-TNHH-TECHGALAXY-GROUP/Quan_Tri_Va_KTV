# Chẩn đoán: Lỗi sửa tên dịch vụ làm mất thẻ đơn đã tách

> **Vai trò tài liệu:** Chỉ nêu NGUYÊN NHÂN. Không đề xuất cách sửa.
> Người thi công tự quyết định phương án.

## Triệu chứng người dùng báo

1. Không đổi tên → gửi bình thường.
2. Ô "Tên DV..." cạnh từng KTV **sửa không được** → phải sửa "tên chính" thay thế.
3. Sửa/xóa tên chính → **thẻ đơn đã tách biến mất**.

## Kết luận quan trọng nhất

**Không có dữ liệu nào bị mất dưới database.** Kiểm chứng trên đơn `11NDK-011-30082026`:

```
NHS1007: technicianCodes=["NH016","NH079"]
         segments = NH016:60p, NH079:60p
         mergedServiceIds=["...item1"]
         customerGroupId=36212368-d6fe-42b0-88f8-8b9fa9d53cf3
         displayName="Ráy tai - Body"        ← chỉ mỗi tên bị cắt cụt
```

Hai KTV còn nguyên, quan hệ gộp còn nguyên, nhóm khách còn nguyên. Cái "mất" là **thẻ trên giao diện**, không phải dữ liệu.

---

## NGUYÊN NHÂN 1 — Mã thẻ đơn con là mã tính toán, đổi hình dạng theo ngữ cảnh

**Vị trí:** `app/reception/dispatch/_components/dispatch-timeline.ts:436`

```ts
const splitIdSuffix = servicesByPhase.size > 1 ? `_${groupingKey}` : '';
const baseId = guestId !== 'default' ? `${order.id}_${guestId}` : `${order.id}_guest${groupIndex}`;
id: `${baseId}${splitIdSuffix}`
```

Thẻ "Đơn Con: 011-A" không phải dòng trong DB. Nó được tính lại mỗi lần render, và mã của nó **có hậu tố hay không tùy vào số nhóm pha**: một nhóm thì hậu tố rỗng, từ hai nhóm trở lên thì gắn thêm `_${groupingKey}`.

`groupingKey` lại phụ thuộc `phase` (suy ra từ `svc.status`) và `_splitTime` — `dispatch-timeline.ts:380-383`. Nghĩa là **trạng thái dịch vụ đổi → nhóm đổi → mã thẻ đổi**.

**Trạng thái đã xác minh:** đơn 011 đang có `item1.status=WAITING` và `item2.status=PREPARING` — hai trạng thái khác nhau trong cùng một đơn, đúng điều kiện sinh nhiều nhóm pha.

## NGUYÊN NHÂN 2 — Mất thẻ thì im lặng rơi về đơn gốc, không báo lỗi

**Vị trí:** `app/reception/dispatch/page.tsx:431`

```ts
const selectedSubOrder = subOrders.find(so => so.id === selectedSubOrderId)
    || (selectedOrder ? { ...toàn bộ đơn gốc... } : null);
```

`selectedSubOrderId` được lưu trong state theo mã cũ. Khi Nguyên nhân 1 làm mã đổi, `find` trả về `undefined` và biểu thức **âm thầm rơi về đơn gốc**.

Với người dùng, hiện tượng đúng là "thẻ đơn con biến mất" — không có thông báo, không có lỗi. Đây là cơ chế trực tiếp tạo ra triệu chứng 3.

## NGUYÊN NHÂN 3 — Đồng bộ ngược ghi đè tên in phiếu bằng `undefined`

**Vị trí:** `app/reception/dispatch/_components/QuickDispatchTable.tsx:434`

```ts
options: { ...updatedServices[svcIdx].options, displayName: state.displayName || undefined },
```

`syncToServices` chạy sau **mỗi lần** `groupStates` thay đổi (`QuickDispatchTable.tsx:525-532`) — tức là mỗi khi chạm vào thời lượng, giờ, ghi chú, hay tên.

Dòng trên luôn ghi đè `options.displayName` bằng `state.displayName`, và khi giá trị đó rỗng thì ghi thẳng `undefined` — **xóa trắng tên in phiếu** mà người dùng vừa gõ ở component khác.

Đây là lý do tên bị cụt thành `"Ráy tai - Body"`: người dùng gõ ở `DispatchServiceBlock`, nhưng `QuickDispatchTable` đồng bộ đè lên.

## NGUYÊN NHÂN 4 — Đồng bộ ngược thay thế toàn bộ `staffList` bằng đúng một phần tử

**Vị trí:** `app/reception/dispatch/_components/QuickDispatchTable.tsx:433`

```ts
updatedServices[svcIdx] = {
    ...updatedServices[svcIdx],
    staffList: [{ id: ..., ktvId, ktvName, segments: [segment], noteForKtv: ..., serviceNameForKtv: ... }],
    ...
};
```

Gán `staffList` thành mảng **một phần tử**, không phải nối thêm.

Ở chế độ nối tiếp, số KTV nhiều hơn số item (`isSequentialMode` — `QuickDispatchTable.tsx:1070`), nên nhiều vòng lặp cùng ghi vào một `svcIdx`. Mỗi vòng lại thay `staffList` bằng một phần tử mới → **lần ghi cuối thắng, KTV trước bị đè mất** ở tầng state giao diện.

Lưu ý: đây là nhánh xử lý "một KTV mỗi dịch vụ". Nhánh `else` ngay dưới (`QuickDispatchTable.tsx:437`) có ghi chú *"extras go as additional staffList entries"* — tức là nhánh kia xử lý đúng. **Cần xác định điều kiện nào chọn nhánh nào**, vì đó là ranh giới giữa chạy đúng và chạy sai.

## NGUYÊN NHÂN 5 — Chỉ số của `ktvServiceNames` lệch giữa lúc ghi và lúc dựng lại

Ô "Tên DV..." đọc/ghi theo **chỉ số dòng** `idx`:

- `QuickDispatchTable.tsx:1475` — `value={state.ktvServiceNames?.[idx]}`
- `QuickDispatchTable.tsx:1064` — `arr[idx] = name`

Nhưng lúc dựng lại state, danh sách được **push tuần tự** khi duyệt qua từng item rồi từng staff (`QuickDispatchTable.tsx:329`):

```ts
ktvServiceNamesList.push(staff.serviceNameForKtv || '');
```

Và một chỗ khác lại tra theo **vị trí của mã KTV** (`QuickDispatchTable.tsx:500`):

```ts
serviceNameForKtv: state.ktvServiceNames?.[state.selectedKtvIds.indexOf(e.ktvId)] || '',
```

Ba cách đánh chỉ số khác nhau cho cùng một mảng. Khi thứ tự duyệt item/staff không trùng thứ tự `selectedKtvIds` — điển hình là chế độ nối tiếp — chữ gõ vào dòng này bị ghi sang dòng khác hoặc bị đọc nhầm ô.

Đây là ứng viên số một cho triệu chứng 2 ("sửa không được"). **Mức độ chắc chắn: suy luận từ code, chưa dựng lại được hiện tượng** — cần một lần tái hiện có quay màn hình để chốt.

## NGUYÊN NHÂN 6 — Nút tự động lưu tên không bao giờ chạy

**Vị trí:** `app/reception/dispatch/_components/DispatchServiceBlock.tsx:272-286`

```ts
onBlur={async () => {
    // "Tự động lưu ngay khi click ra ngoài (Blur) để chống mất dữ liệu"
    const { getSupabaseAdmin } = await import('@/lib/supabaseAdmin');
    const supabase = getSupabaseAdmin();
    if (supabase) { await supabase.from('BookingItems').update({...}).eq('id', svc.id); }
}}
```

`DispatchServiceBlock.tsx:1` khai báo `'use client'` — component chạy trong trình duyệt.

`lib/supabaseAdmin.ts:10` đọc `process.env.SUPABASE_SERVICE_ROLE_KEY`. Biến này **không có tiền tố `NEXT_PUBLIC_`**, nên Next.js không đưa vào bundle trình duyệt. Giá trị luôn `undefined` → `lib/supabaseAdmin.ts:12-15` trả về `null` → khối `if (supabase)` không bao giờ chạy.

**Tính năng sinh ra để "chống mất dữ liệu" thực tế không lưu gì cả.** Tên chỉ tồn tại trong state React cho tới khi có một lần lưu thật.

*Ghi chú phụ:* khóa service-role không bị lộ ra trình duyệt (vì Next.js chặn), nên đây không phải lỗ hổng bảo mật. Nhưng gọi client quản trị từ component trình duyệt là sai kiến trúc.

---

## Bản đồ nguyên nhân → triệu chứng

| Triệu chứng | Nguyên nhân |
|---|---|
| Ô "Tên DV..." sửa không được | **NN 5** (chính), **NN 4** |
| Sửa tên chính xong mất thẻ đơn tách | **NN 1 + NN 2** (chuỗi liên hoàn) |
| Tên bị cắt cụt còn "Ráy tai - Body" | **NN 3**, **NN 6** |
| Nối tiếp chỉ còn 1 KTV ở giao diện | **NN 4** |

## Mức độ chắc chắn

**Đã kiểm chứng bằng dữ liệu thật hoặc đọc trực tiếp code:** NN 1, 2, 3, 4, 6.

**Suy luận từ code, chưa tái hiện:** NN 5.

## Việc cần làm trước khi sửa

Tái hiện có quay màn hình, ghi lại: trạng thái từng item trước và sau, `selectedSubOrderId` trong React DevTools, và giá trị `state.ktvServiceNames` khi gõ. Không có bước này thì NN 5 vẫn là giả thuyết.

## Ranh giới cần giữ

- Đơn `11NDK-011-30082026` dữ liệu còn nguyên — **không cần vá dữ liệu**, chỉ sửa code.
- NN 3 và NN 4 nằm trong `syncToServices`, chạy rất thường xuyên. Sửa sai chỗ này ảnh hưởng toàn bộ màn hình điều phối, không riêng ca nối tiếp.
- NN 1 và NN 2 nằm ở tầng dựng thẻ Kanban, ảnh hưởng cả đơn nhiều khách chứ không riêng nối tiếp.
