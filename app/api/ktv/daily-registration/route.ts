import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';
import { requireActiveStaff } from '@/lib/auth-server';
import { vnDate } from '@/lib/vn-time';

export async function POST(request: Request) {
  try {
    const lockedError = await requireActiveStaff();
    if (lockedError) return lockedError;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Lấy thông tin KTV
    const username = (user.email || '').split('@')[0];
    const { data: dbUser } = await supabase.from('Users').select('code').ilike('username', username).single();
    const { data: staff } = dbUser ? await supabase.from('Staff').select('id, work_type').eq('id', dbUser.code).single() : { data: null };

    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
    }

    if (staff.work_type !== 'TYPE_D') {
      return NextResponse.json({ error: 'Chỉ áp dụng cho KTV TYPE_D' }, { status: 403 });
    }

    const body = await request.json();
    const { work_date, dates, type, expected_time, entries } = body;
    // Hỗ trợ payload cũ (dates, work_date) và mới (entries)
    const targetDates: string[] = dates || (work_date ? [work_date] : []);
    
    // Normalize thành dạng entry: { work_date, expected_time }
    let processedEntries: { work_date: string; expected_time: string | null }[] = [];
    if (entries && entries.length > 0) {
      processedEntries = entries;
    } else {
      processedEntries = targetDates.map(d => ({
        work_date: d,
        expected_time: type === 'WORKING' ? expected_time : null
      }));
    }

    if (processedEntries.length === 0 || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { canEditRegistration, getRegistrationEditWindow, vnNow } = await import('@/lib/vn-time');

    for (const entry of processedEntries) {
      if (!canEditRegistration(entry.work_date)) {
        return NextResponse.json(
          { error: 'Từ 07:00 sáng ngày làm việc thì không đổi lịch được nữa. Bạn chỉ còn quyền BÁO ĐI MUỘN 1 lần.' },
          { status: 400 });
      }
      
      if (type === 'WORKING') {
        if (!entry.expected_time) {
          return NextResponse.json({ error: `Vui lòng nhập giờ đến tiệm cho ngày ${vnDate(entry.work_date)}` }, { status: 400 });
        }
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.expected_time)) {
          return NextResponse.json({ error: `Giờ đến tiệm ngày ${vnDate(entry.work_date)} không hợp lệ (HH:mm)` }, { status: 400 });
        }
      }
    }

    // Lấy thông tin các ngày đã đăng ký để kiểm tra check_in_at
    const datesToUpdate = processedEntries.map(e => e.work_date);
    const { data: existingRecords } = await supabase
      .from('KTVTypeDDailyRegistration')
      .select('work_date, status, check_in_at, penalty_applied')
      .eq('staff_id', staff.id)
      .in('work_date', datesToUpdate);
      
    if (existingRecords) {
      for (const rec of existingRecords) {
        if (rec.check_in_at || rec.penalty_applied) {
          return NextResponse.json({ error: `Ngày ${rec.work_date} đã có check-in hoặc bị phạt, không thể sửa.` }, { status: 400 });
        }
      }
    }

    // ⚠️ HUỶ ĐĂNG KÝ = CHUYỂN SANG OFF, không xoá bản ghi.
    // Trước đây `CANCEL` xoá sạch dòng đăng ký. Cron chốt sổ cuối ngày thấy
    // "không đăng ký gì" → KHOÁ TÀI KHOẢN. Nghĩa là KTV bấm một nút trông vô
    // hại là mất tài khoản, không cảnh báo gì.
    const effectiveType = type === 'CANCEL' ? 'OFF' : type;
    const status = effectiveType === 'OFF' ? 'OFF_REGISTERED' : 'REGISTERED';

    // ─── Trừ 5 giờ nếu bỏ ca sau hạn miễn phạt ────────────────────────
    // Bỏ ca = đang đăng ký LÀM mà chuyển sang OFF (hoặc bấm huỷ).
    // Hạn miễn phạt: hết ngày hôm trước (00:00 ngày làm). Quá hạn vẫn cho đổi,
    // nhưng trừ 5 giờ tích lũy — giao diện đã cảnh báo trước khi xác nhận.
    const penalised: { work_date: string; hours: number }[] = [];

    if (effectiveType === 'OFF') {
      const dangDangKyLam = new Set(
        (existingRecords || [])
          .filter((r: any) => r.status === 'REGISTERED' || r.status === 'LATE_REPORTED')
          .map((r: any) => r.work_date));

      for (const entry of processedEntries) {
        if (!dangDangKyLam.has(entry.work_date)) continue;              // vốn đã OFF → không phạt
        if (getRegistrationEditWindow(entry.work_date) !== 'PENALTY') continue;

        const { KtvTypeDDisciplineService } = await import('@/lib/services/KtvTypeDDisciplineService');
        const hours = await KtvTypeDDisciplineService.deductDailyViolation(
          supabase as any, staff.id, entry.work_date, 'ABSENT_EARLY_NOTICE',
          'Bỏ ca đã đăng ký sau 00:00 ngày làm việc', staff.id,
        );
        // Kỷ luật tắt thì deductDailyViolation trả 0 và không ghi sổ — đừng
        // đưa vào danh sách, kẻo màn hình báo "bị trừ 0 giờ".
        if (hours > 0) penalised.push({ work_date: entry.work_date, hours });
      }
    }

    const upsertData = processedEntries.map(entry => ({
        staff_id: staff.id,
        work_date: entry.work_date,
        expected_time: effectiveType === 'WORKING' ? entry.expected_time : null,
        status,
        registered_at: vnNow().toISOString()
    }));

    const { data, error } = await supabase
      .from('KTVTypeDDailyRegistration')
      .upsert(upsertData, { onConflict: 'staff_id,work_date' })
      .select();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data,
      penalised,
      message: penalised.length > 0
        ? `Đã chuyển sang OFF. Bạn bị trừ ${penalised[0].hours} giờ tích lũy do bỏ ca sau 00:00 ngày làm việc.`
        : (type === 'CANCEL' ? 'Đã chuyển ngày này sang OFF.' : undefined),
    });
  } catch (error: any) {
    console.error('Error in daily-registration:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const lockedError = await requireActiveStaff();
    if (lockedError) return lockedError;

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const username = (user.email || '').split('@')[0];
    const { data: dbUser } = await supabase.from('Users').select('code').ilike('username', username).single();
    const { data: staff } = dbUser ? await supabase.from('Staff').select('id, work_type').eq('id', dbUser.code).single() : { data: null };
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    let query = supabase.from('KTVTypeDDailyRegistration').select('*').eq('staff_id', staff.id);
    if (from) query = query.gte('work_date', from);
    if (to) query = query.lte('work_date', to);

    const { data, error } = await query;
    if (error) throw error;
    // `staff_id` = danh tinh server doc tu JWT. Client phai doi chieu voi phien
    // cua tab minh: cookie Supabase dung chung ca trinh duyet, con phien nghiep
    // vu nam o sessionStorage tung tab -> mo 2 tai khoan tren cung trinh duyet
    // la hai ben lech nhau. Khong tra truong nay thi lech ay bieu hien thanh
    // "lich trong tron, khong bao loi".
    return NextResponse.json({ data: data || [], staff_id: staff.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

