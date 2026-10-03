import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';
import { requireActiveStaff } from '@/lib/auth-server';

export async function POST(request: Request) {
  try {
    const lockedError = await requireActiveStaff();
    if (lockedError) return lockedError;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = (user.email || '').split('@')[0];
    const { data: dbUser } = await supabase.from('Users').select('code').ilike('username', username).single();
    const { data: staff } = dbUser ? await supabase.from('Staff').select('id, work_type, online_status').eq('id', dbUser.code).single() : { data: null };

    if (!staff || staff.work_type !== 'TYPE_D') {
      return NextResponse.json({ error: 'Chỉ áp dụng cho KTV TYPE_D' }, { status: 403 });
    }

    const body = await request.json();
    const { action, late_expected_time } = body; // action: 'REPORT_ABSENT' | 'REPORT_LATE'

    const { vnNow, vnHour } = await import('@/lib/vn-time');
    const { getBusinessToday, phutTrongNgayLamViec, getDayCutoffHours } = await import('@/lib/business-date');
    
    // NGÀY LÀM VIỆC, không phải ngày lịch: 01:00 rạng sáng vẫn thuộc ca hôm
    // trước, nên báo muộn / báo vắng phải nhắm vào dòng đăng ký của ca đó.
    const now = vnNow();
    const cutoffHours = await getDayCutoffHours(supabase as any);
    const todayStr = await getBusinessToday(supabase as any);
    const hour = vnHour();
    const phutBayGio = phutTrongNgayLamViec(format(now, 'HH:mm'), cutoffHours) ?? 0;
    const phutCuaGio = (t: string | null) => phutTrongNgayLamViec(String(t || '').slice(0, 5), cutoffHours);
    
    // Lấy bản ghi đăng ký hôm nay
    const { data: registration, error: fetchError } = await supabase
      .from('KTVTypeDDailyRegistration')
      .select('*')
      .eq('staff_id', staff.id)
      .eq('work_date', todayStr)
      .single();

    if (fetchError || !registration) {
      return NextResponse.json({ error: 'Bạn chưa đăng ký lịch làm việc cho hôm nay.' }, { status: 400 });
    }

    if (registration.status === 'OFF_REGISTERED') {
      return NextResponse.json({ error: 'Bạn đã đăng ký nghỉ hôm nay.' }, { status: 400 });
    }
    
    if (registration.check_in_at) {
        return NextResponse.json({ error: 'Bạn đã điểm danh, không thể điều chỉnh nữa.' }, { status: 400 });
    }

    // Still at the spa (e.g. last night's shift running past 00:00): today's row
    // has no check-in yet, but reporting late/absent makes no sense.
    if ((staff as any).online_status === 'AT_VENUE') {
        return NextResponse.json({ error: 'Bạn đang ở tiệm, không cần báo đi muộn hay báo vắng.' }, { status: 400 });
    }

    if (action === 'REPORT_ABSENT') {
      // Chỉ cho phép Báo Vắng trước 07:00
      if (hour >= 7) {
        return NextResponse.json({ error: 'Không thể báo vắng từ 07:00 trở đi. Chỉ có thể báo trễ.' }, { status: 400 });
      }

      // Đã tới giờ hẹn rồi thì không còn gì để "báo vắng" — lúc đó là vắng thật,
      // để cron chốt sổ xử. Cho bấm là mở đường lách sau khi đã trễ.
      const phutHenVang = phutCuaGio(registration.expected_time);
      if (phutHenVang !== null && phutBayGio >= phutHenVang) {
        return NextResponse.json({ error: 'Đã tới giờ hẹn, không báo vắng được nữa.' }, { status: 400 });
      }

      // Theo quy tắc Mục 14: Chỉ update DB, KHÔNG TRỪ GIỜ PHẠT NGAY. Chờ cron cuối ngày.
      const { error: updateError } = await supabase
        .from('KTVTypeDDailyRegistration')
        .update({
          status: 'ABSENT_REPORTED',
          absent_reported_at: new Date().toISOString()
        })
        .eq('id', registration.id);

      if (updateError) throw updateError;
      return NextResponse.json({ success: true, message: 'Đã ghi nhận báo vắng. (Chưa bị trừ giờ cho đến khi chốt sổ 23:59)' });
      
    } else if (action === 'REPORT_LATE') {
      if (!late_expected_time) {
        return NextResponse.json({ error: 'Vui lòng nhập giờ hẹn có mặt' }, { status: 400 });
      }

      if (registration.late_report_count >= 1) {
        return NextResponse.json({ error: 'Bạn chỉ được báo trễ 1 lần trong ngày.' }, { status: 400 });
      }

      // So bằng PHÚT TRONG NGÀY LÀM VIỆC, không so đồng hồ trần: ca chạy qua
      // nửa đêm nên 23:00 không được coi là muộn hơn 01:50 của cùng ca.
      const phutHen = phutCuaGio(registration.expected_time);
      if (phutHen !== null && phutBayGio >= phutHen) {
        return NextResponse.json({ error: 'Đã qua giờ đăng ký gốc, không thể báo trễ.' }, { status: 400 });
      }

      const phutHenTre = phutCuaGio(late_expected_time);
      if (phutHenTre === null) {
        return NextResponse.json({ error: 'Giờ hẹn trễ không hợp lệ (HH:mm)' }, { status: 400 });
      }
      if (phutHenTre <= phutBayGio) {
        return NextResponse.json({ error: 'Giờ hẹn trễ phải sau thời điểm hiện tại.' }, { status: 400 });
      }

      const { error: updateError } = await supabase
        .from('KTVTypeDDailyRegistration')
        .update({
          status: 'LATE_REPORTED',
          late_reported_at: new Date().toISOString(),
          late_expected_time: late_expected_time,
          late_report_count: registration.late_report_count + 1
        })
        .eq('id', registration.id);

      if (updateError) throw updateError;
      return NextResponse.json({ success: true, message: 'Đã ghi nhận báo trễ.' });
    } else {
      return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Error in attendance-adjustment:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
