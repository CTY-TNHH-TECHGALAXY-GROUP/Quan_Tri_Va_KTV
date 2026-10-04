/**
 * Chuẩn bị cho RPC `dispatch_assign_sequential_slot_b` khi gán B qua popup bàn giao
 * trực tiếp (`handoffSequentialKtv`).
 *
 * RPC đòi KTV B phải có dòng `TurnQueue` của ngày làm việc, trạng thái `waiting`.
 * Form điều phối (`dispatch_commit_form`) tự chèn dòng này cho KTV thiếu
 * (`turnStaffIds`, migration 20260929160000) trước khi gán B, nhưng popup bàn giao
 * gọi thẳng RPC nên KTV ngoài (`EXT_`/`C_`, không điểm danh) bị "KTV B không còn
 * rảnh". Hàm này làm đúng việc form đang làm: chèn dòng `waiting` ở cuối hàng.
 *
 * Không import alias `@/` để test mock bằng Node chạy thẳng file .ts.
 */

type SupabaseLike = {
  from: (table: string) => any;
};

export type EnsureTurnRowResult =
  | { ok: true; inserted: boolean; businessDate: string | null }
  | { ok: false; error: string };

/**
 * Ngày làm việc của lượt này = `business_date` của phân công A (không huỷ) trên
 * cùng dịch vụ — cùng nguồn RPC dùng, nên ca đêm qua 0h vẫn khớp.
 */
export async function businessDateOfItem(
  supabase: SupabaseLike,
  bookingId: string,
  itemId: string
): Promise<{ date: string | null; error?: string }> {
  const { data, error } = await supabase
    .from('KtvAssignments')
    .select('business_date')
    .eq('booking_id', bookingId)
    .eq('booking_item_id', itemId)
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { date: null, error: `Không đọc được phân công A: ${error.message}` };
  return { date: data?.business_date ? String(data.business_date) : null };
}

export async function ensureTurnQueueRowForSequentialB(
  supabase: SupabaseLike,
  input: { bookingId: string; itemId: string; ktvId: string }
): Promise<EnsureTurnRowResult> {
  const day = await businessDateOfItem(supabase, input.bookingId, input.itemId);
  if (day.error) return { ok: false, error: day.error };
  // Không tìm thấy A → để RPC tự báo "Không tìm thấy phân công của A".
  if (!day.date) return { ok: true, inserted: false, businessDate: null };

  const { data: existing, error: exErr } = await supabase
    .from('TurnQueue').select('id').eq('employee_id', input.ktvId).eq('date', day.date).maybeSingle();
  if (exErr) return { ok: false, error: `Không đọc được sổ tua: ${exErr.message}` };
  if (existing) return { ok: true, inserted: false, businessDate: day.date };

  const [{ data: posRow }, { data: cioRow }] = await Promise.all([
    supabase.from('TurnQueue').select('queue_position').eq('date', day.date).order('queue_position', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('TurnQueue').select('check_in_order').eq('date', day.date).order('check_in_order', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const row = {
    employee_id: input.ktvId,
    date: day.date,
    status: 'waiting',
    queue_position: Number(posRow?.queue_position || 0) + 1,
    check_in_order: Number(cioRow?.check_in_order || 0) + 1,
    turns_completed: 0,
  };
  // Hai máy quầy cùng gán → UNIQUE (employee_id, date) giữ một dòng, dòng sau bỏ qua.
  const { error: insErr } = await supabase
    .from('TurnQueue').upsert(row, { onConflict: 'employee_id,date', ignoreDuplicates: true });
  if (insErr) return { ok: false, error: `Không thêm được KTV B vào sổ tua: ${insErr.message}` };
  return { ok: true, inserted: true, businessDate: day.date };
}

/** Đổi khoá metadata (tên dịch vụ / ghi chú theo KTV) từ token `NEW_EXT:` sang mã thật. */
export function renameMetadataKey<T extends { serviceNamesForKtvs: Record<string, string>; notesForKtvs: Record<string, string> }>(
  metadata: T | undefined,
  fromKey: string,
  toKey: string
): T | undefined {
  if (!metadata || fromKey === toKey) return metadata;
  const move = (map: Record<string, string>) => {
    if (!(fromKey in map)) return map;
    const { [fromKey]: value, ...rest } = map;
    return { ...rest, [toKey]: value };
  };
  return { ...metadata, serviceNamesForKtvs: move(metadata.serviceNamesForKtvs), notesForKtvs: move(metadata.notesForKtvs) };
}
