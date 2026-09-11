import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, BellRing, MapPin, Loader2, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';
import { fmtGioBuoi } from '@/lib/hours-format';
import { vnNow } from '@/lib/vn-time';
import { format } from 'date-fns';

interface OnCallState {
  allow_on_call: boolean;
  is_on_call: boolean;
  online_status: 'ONLINE' | 'AT_VENUE' | 'OFFLINE';
  travel_time_mins: number;
  isOffToday?: boolean;
}

interface Props {
  ktvId: string;
  checkStatus?: string;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onRefreshStatus?: () => void;
  incompleteTasksCount?: number;
  /** Nợ phòng: bàn giao chưa nộp / phòng đang dọn dở. Còn nợ là chưa cho tan ca. */
  roomDebt?: { handover: number; cleaning: number; total: number; items: any[] };
  guestArrivalLock?: { active: boolean; message: string };
}

/** 'HH:MM:SS' hoặc 'HH:MM' đều về 'HH:MM'. */
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : '');

/** Số phút từ mốc này tới mốc kia trong cùng một ngày. */
const phutLech = (tu: string, den: string) => {
  const p = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return p(den) - p(tu);
};

/** 90 → "1 giờ 30 phút", 30 → "30 phút". */
const dienGiaiPhut = (n: number) => {
  const h = Math.floor(n / 60), m = n % 60;
  return [h ? `${h} giờ` : '', m ? `${m} phút` : ''].filter(Boolean).join(' ') || '0 phút';
};

export default function AttendanceTypeD({ ktvId, checkStatus, onCheckIn, onCheckOut, onRefreshStatus, incompleteTasksCount = 0, roomDebt, guestArrivalLock }: Props) {
  const { addToast } = useToast();
  const [state, setState] = useState<OnCallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Popup Bật Nhận Đơn
  const [showPopup, setShowPopup] = useState(false);
  const [tempMins, setTempMins] = useState(30);
  const [expectedEnd, setExpectedEnd] = useState('');

  // ─── BÁO ĐI MUỘN ────────────────────────────────────────────────
  // Sau 07:00 thì KTV hết quyền đổi lịch, chỉ còn được BÁO TRỄ đúng 1 lần.
  // Đến muộn hơn giờ đã hẹn thì bị trừ 5 giờ tích lũy.
  const [registration, setRegistration] = useState<any>(null);
  const [showLateModal, setShowLateModal] = useState(false);
  const [lateTime, setLateTime] = useState('');

  const vnToday = () => {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  };

  const fetchRegistration = async () => {
    try {
      const today = vnToday();
      const res = await apiClient.get<any>(`/api/ktv/daily-registration?from=${today}&to=${today}`);
      setRegistration((res?.data || [])[0] || null);
    } catch { /* không chặn màn hình chấm công */ }
  };

  const handleReportLate = async () => {
    if (!lateTime) return addToast('Vui lòng chọn giờ bạn sẽ có mặt', 'error');
    setActionLoading(true);
    try {
      const res = await apiClient.post<any>('/api/ktv/attendance-adjustment', {
        action: 'REPORT_LATE',
        late_expected_time: lateTime,
      });
      if (res?.success) {
        addToast('✅ Đã báo đi muộn. Nhớ có mặt đúng giờ đã hẹn nhé!', 'success');
        setShowLateModal(false);
        fetchRegistration();
      } else {
        addToast(res?.error || 'Không báo được', 'error');
      }
    } catch (e: any) {
      addToast('Lỗi kết nối: ' + e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Chỉ hiện nút khi: đã đăng ký LÀM, chưa điểm danh, và chưa dùng lượt báo trễ.
  // Giờ KTV đã tự đăng ký cho hôm nay — mốc để đối chiếu khi báo trễ.
  const gioDaDangKy = hhmm(registration?.expected_time);
  const lechPhut = (gioDaDangKy && lateTime) ? phutLech(gioDaDangKy, lateTime) : null;

  const daBaoTre = (registration?.late_report_count || 0) >= 1;

  /**
   * ĐÃ QUÁ giờ đã đăng ký.
   *
   * "Báo đi muộn" là báo TRƯỚC — hẹn lại một mốc muộn hơn để khỏi bị tính lỗi.
   * Quá giờ rồi thì không còn gì để báo trước: người đó đang muộn thật. Cho bấm
   * lúc này là mở đường lách — cứ muộn xong mới báo thì luật đi trễ thành vô nghĩa.
   *
   * So sánh chuỗi 'HH:MM' được vì cùng định dạng 2 chữ số, không cần dựng Date.
   */
  const gioHienTai = format(vnNow(), 'HH:mm');
  const daQuaGioDangKy = !!gioDaDangKy && gioHienTai > gioDaDangKy;

  const chuaDiemDanh = !!registration
    && registration.status !== 'OFF_REGISTERED'
    && !registration.check_in_at;

  // Còn hiện nút (dù xám) để KTV biết vì sao không bấm được, thay vì nút biến mất
  // không dấu vết rồi họ đi hỏi quản lý.
  const hienNutBaoTre = chuaDiemDanh && !daBaoTre;
  const coTheBaoTre = hienNutBaoTre && !daQuaGioDangKy;

  const fetchState = async () => {
    try {
      const res = await apiClient.get<any>(`${API.KTV.TYPE_D_ON_CALL}?techCode=${ktvId}`);
      if (res.success && res.data) {
        setState(res.data);
        if (res.data.travel_time_mins) {
            setTempMins(res.data.travel_time_mins);
        }
      }
    } catch (e) {
      console.error('Lỗi khi lấy trạng thái on-call', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ktvId) { fetchState(); fetchRegistration(); }
    const interval = setInterval(fetchState, 30000); // Polling every 30s
    return () => clearInterval(interval);
  }, [ktvId]);

  // Điểm danh xong là nạp lại NGAY, đừng bắt chờ vòng poll 30 giây.
  //
  // `checkStatus` do trang cha đổi ngay khi API trả về, nhưng trạng thái hiện trên
  // component này lại lấy từ `state.online_status` của chính nó — nên trước đây bấm
  // xong màn hình đứng yên tới nửa phút, nhân viên tưởng hỏng và bấm lại lần nữa.
  useEffect(() => {
    if (!ktvId) return;
    if (checkStatus === 'CONFIRMED' || checkStatus === 'CHECKED_OUT' || checkStatus === 'PENDING') {
      fetchState(); fetchRegistration();
    }
  }, [checkStatus, ktvId]);

  const handleToggleOnCall = async (isOnCall: boolean, mins: number, end?: string) => {
    setActionLoading(true);
    try {
      const res = await apiClient.post<any>(API.KTV.TYPE_D_ON_CALL, {
        techCode: ktvId,
        is_on_call: isOnCall,
        travel_time_mins: mins,
        expected_end: end
      });
      if (res.success) {
        setShowPopup(false);
        await fetchState();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        addToast(res.error || 'Có lỗi xảy ra', 'error');
      }
    } catch (e) {
      addToast('Lỗi kết nối', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <p className="text-gray-500 font-medium">Đang tải trạng thái...</p>
      </div>
    );
  }

  /**
   * Cờ `allow_on_call` chỉ quản đúng MỘT thứ: chế độ nhận đơn ngoài giờ.
   *
   * ⚠️ Trước đây chỗ này `return` sớm cả màn hình khi cờ tắt, kèm câu "Tính năng
   * không khả dụng". Nhưng đây là TOÀN BỘ màn Điểm Danh của loại D — tắt cờ là
   * KTV mất luôn nút "Oria Xin chào" và "Oria Xin cảm ơn", tức là không điểm
   * danh và không tan ca được. Một cần gạt phụ khoá mất chức năng chính.
   *
   * Nay cờ tắt thì chỉ ẩn cụm nhận đơn; điểm danh và tan ca giữ nguyên.
   */
  const canOnCall = state?.allow_on_call === true;

  // Không gọi được API on-call cũng không được để màn hình chết — coi như đang
  // tắt, KTV vẫn phải điểm danh được.
  const onlineStatus = state?.online_status ?? 'OFFLINE';

  // Not gated on `canOnCall`: admin can revoke the flag while the KTV is still
  // ONLINE, and hiding this state would also hide the only "Tắt Nhận Đơn" button.
  const isOnline = onlineStatus === 'ONLINE';
  // Ngăn lỗi kẹt trạng thái AT_VENUE sang ngày mới: Chỉ khi đã điểm danh hôm nay mới tính là AT_VENUE.
  const isAtVenue = onlineStatus === 'AT_VENUE' && checkStatus !== 'IDLE' && checkStatus !== 'CHECKED_OUT';
  const isOffline = !isOnline && !isAtVenue;

  const getPreviewTime = () => {
    const vnTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    vnTime.setMinutes(vnTime.getMinutes() + tempMins);
    return `${vnTime.getHours().toString().padStart(2, '0')}:${vnTime.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {state?.isOffToday && (
        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-left">
            <p className="text-amber-800 font-bold">Hôm nay bạn đã đăng ký nghỉ</p>
            <p className="text-sm text-amber-600">
              {canOnCall
                ? 'Nếu đổi ý, bấm bật nhận đơn để đi làm bình thường.'
                : 'Nếu đổi ý, bấm "Oria Xin chào" để đi làm bình thường.'}
            </p>
          </div>
        </div>
      )}

      {/* TRẠNG THÁI HIỆN TẠI */}
      <div className={`p-6 rounded-[32px] border ${
        isAtVenue ? 'bg-emerald-50 border-emerald-200' :
        isOnline ? 'bg-blue-50 border-blue-200' :
        'bg-slate-50 border-slate-200'
      } flex flex-col items-center text-center shadow-sm`}>
        <div className={`w-16 h-16 rounded-full mb-4 flex items-center justify-center ${
            isAtVenue ? 'bg-emerald-100 text-emerald-600' :
            isOnline ? 'bg-blue-100 text-blue-600' :
            'bg-slate-200 text-slate-500'
        }`}>
            {isAtVenue ? <MapPin size={32} /> : isOnline ? <BellRing size={32} className="animate-pulse" /> : <LogOut size={32} />}
        </div>
        <h3 className={`text-xl font-black mb-1 ${
            isAtVenue ? 'text-emerald-700' :
            isOnline ? 'text-blue-700' :
            'text-slate-600'
        }`}>
            {isAtVenue ? 'ĐÃ TỚI TIỆM' : isOnline ? 'ĐANG CHỜ ĐƠN' : canOnCall ? 'ĐANG TẮT' : 'CHƯA ĐIỂM DANH'}
        </h3>
        <p className="text-sm font-medium text-slate-500">
            {isAtVenue ? 'Đã tới tiệm. Vui lòng bàn giao đồ và sẵn sàng nhận tour.' :
             isOnline ? `Đang sẵn sàng từ nhà. Thời gian di chuyển: ${state?.travel_time_mins ?? 0} phút.` :
             // Cờ nhận đơn ngoài giờ đang tắt thì đừng nhắc chuyện "bật nhận đơn" —
             // KTV không có nút nào để bật, đọc xong chỉ thêm hoang mang.
             canOnCall ? 'Chưa bật nhận đơn. Hãy bật khi bạn rảnh.'
                       : 'Bấm "Oria Xin chào" khi bạn tới tiệm để bắt đầu ca.'}
        </p>
      </div>

      {/* ─── BÁO ĐI MUỘN ─── */}
      {daBaoTre && registration?.late_expected_time && (
        <div className="mb-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">
              Đã báo đi muộn — hẹn có mặt {fmtGioBuoi(registration.late_expected_time)}
              {gioDaDangKy && <span className="font-medium"> (đăng ký ban đầu {fmtGioBuoi(gioDaDangKy)})</span>}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Chỉ được báo 1 lần. Đến muộn hơn giờ đã hẹn sẽ bị trừ 5 giờ tích lũy.
            </p>
          </div>
        </div>
      )}

      {hienNutBaoTre && (
        <button
          onClick={() => { if (coTheBaoTre) setShowLateModal(true); }}
          disabled={actionLoading || !coTheBaoTre}
          className={`w-full mb-4 py-3 border-2 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 ${
            coTheBaoTre
              ? 'bg-white border-amber-300 hover:bg-amber-50 active:scale-95 text-amber-700 disabled:opacity-50'
              : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Clock size={20} /> {coTheBaoTre ? 'Báo đi muộn' : `Đã quá giờ đăng ký (${gioDaDangKy})`}
        </button>
      )}

      {/* CÁC NÚT ĐIỀU KHIỂN */}
      <div className="space-y-4">
        {/* Nếu đang tắt -> Hiện Bật nhận đơn VÀ Tới tiệm luôn */}
        {isOffline && (
            <div className="space-y-4">
                <button
                    onClick={() => onCheckIn()}
                    disabled={actionLoading}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    <LogIn size={22} /> {actionLoading ? 'Đang xử lý...' : 'Oria Xin chào'}
                </button>
                {/* CHỈ nút này thuộc cờ nhận đơn ngoài giờ. Điểm danh ở trên không dính. */}
                {canOnCall && (
                  <button
                      onClick={() => setShowPopup(true)}
                      disabled={actionLoading}
                      className="w-full py-4 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                      <BellRing size={22} /> {actionLoading ? 'Đang xử lý...' : 'Bật Nhận Đơn'}
                  </button>
                )}
            </div>
        )}

        {/* Nếu đang chờ đơn (ONLINE) -> Báo tới tiệm hoặc Tắt */}
        {isOnline && (
            <>
                <button
                    onClick={() => onCheckIn()}
                    disabled={actionLoading}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    <LogIn size={22} /> {actionLoading ? 'Đang xử lý...' : 'Oria Xin chào'}
                </button>
                <div className="w-full">
                  <button
                      onClick={() => {
                        if (incompleteTasksCount > 0 || (roomDebt?.total ?? 0) > 0 || guestArrivalLock?.active) return;
                        handleToggleOnCall(false, state?.travel_time_mins ?? 30);
                      }}
                      disabled={actionLoading || incompleteTasksCount > 0 || (roomDebt?.total ?? 0) > 0 || guestArrivalLock?.active}
                      className={`w-full py-4 font-bold text-lg rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all
                        ${guestArrivalLock?.active 
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                            : 'bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700'
                        }`}
                  >
                      <LogOut size={22} className="rotate-180" /> {actionLoading ? 'Đang xử lý...' : 'Tắt Nhận Đơn'}
                  </button>
                  {incompleteTasksCount > 0 && !guestArrivalLock?.active && (
                      <p className="text-red-500 text-xs text-center mt-2 font-medium">Bạn còn {incompleteTasksCount} công việc chưa hoàn thành. Không thể tắt nhận đơn.</p>
                  )}
                </div>
            </>
        )}

        {/* Nếu đã tới tiệm (AT_VENUE) -> Tan Ca */}
        {isAtVenue && (
             <div className="w-full">
               <button
                  onClick={() => {
                    if (incompleteTasksCount > 0 || (roomDebt?.total ?? 0) > 0 || guestArrivalLock?.active) return;
                    onCheckOut();
                  }}
                  disabled={actionLoading || incompleteTasksCount > 0 || (roomDebt?.total ?? 0) > 0 || guestArrivalLock?.active}
                  className={`w-full py-4 font-bold text-lg rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50
                    ${guestArrivalLock?.active 
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                        : 'bg-rose-600 hover:bg-rose-700 active:scale-95 text-white transition-all shadow-md shadow-rose-200'
                    }`}
              >
                  <LogOut size={22} /> {actionLoading ? 'Đang xử lý...' : 'Oria Xin cảm ơn'}
              </button>
              {(roomDebt?.total ?? 0) > 0 && !guestArrivalLock?.active && (
                  <p className="text-red-500 text-xs text-center mt-2 font-medium">
                    Bạn còn nợ {roomDebt!.total} phòng
                    {roomDebt!.handover > 0 ? ` · ${roomDebt!.handover} chưa nộp ảnh bàn giao` : ''}
                    {roomDebt!.cleaning > 0 ? ` · ${roomDebt!.cleaning} đang dọn dở` : ''}.
                    Trả hết nợ mới tan ca được.
                  </p>
              )}
              {incompleteTasksCount > 0 && (roomDebt?.total ?? 0) === 0 && !guestArrivalLock?.active && (
                  <p className="text-red-500 text-xs text-center mt-2 font-medium">Bạn còn {incompleteTasksCount} công việc chưa hoàn thành. Không thể tan ca.</p>
              )}
             </div>
        )}
      </div>

      {/* HỘP THOẠI BÁO ĐI MUỘN */}
      {showLateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center">
                <Clock size={22} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-lg">Báo đi muộn</h3>
                <p className="text-xs text-slate-500">Chỉ được báo 1 lần trong ngày</p>
              </div>
            </div>

            {/* Giờ đã đăng ký, để đối chiếu ngay tại chỗ. Trước đây hộp thoại
                không nhắc gì, muốn xem lại phải thoát ra mở trang Lịch rồi vào lại. */}
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 px-4 py-2.5">
              <span className="text-xs font-medium text-slate-500">Giờ bạn đã đăng ký hôm nay</span>
              <span className="text-sm font-black text-slate-800">{fmtGioBuoi(gioDaDangKy) || 'Chưa đặt giờ'}</span>
            </div>

            <label className="text-sm font-bold text-slate-700 block mb-2">
              Bạn sẽ có mặt lúc mấy giờ?
            </label>
            <input
              type="time"
              value={lateTime}
              onChange={(e) => setLateTime(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-2xl p-3 text-lg font-bold text-slate-700 focus:border-amber-400 outline-none"
            />

            {/* Con số chỉ có nghĩa khi đặt cạnh giờ đã đăng ký. Chọn giờ không
                muộn hơn thì báo đỏ — mỗi ngày chỉ được báo 1 lần, bấm nhầm là mất. */}
            {lechPhut !== null && (
              lechPhut > 0 ? (
                <p className="mt-2 text-xs font-bold text-amber-700">
                  Muộn hơn giờ đã đăng ký {dienGiaiPhut(lechPhut)}.
                </p>
              ) : (
                <p className="mt-2 text-xs font-bold text-rose-600">
                  Giờ này không muộn hơn giờ bạn đã đăng ký ({gioDaDangKy}) — kiểm tra lại,
                  vì mỗi ngày bạn chỉ được báo 1 lần.
                </p>
              )
            )}

            <div className="mt-4 p-3 rounded-2xl bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                Nếu bạn đến muộn hơn giờ vừa hẹn, hệ thống sẽ <strong>trừ 5 giờ tích lũy</strong>.
                Giờ tích lũy quyết định thứ tự nhận khách của bạn.
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowLateModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all"
              >
                Huỷ
              </button>
              <button
                onClick={handleReportLate}
                disabled={actionLoading || !lateTime}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={18} className="animate-spin" /> : null}
                Xác nhận
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* POPUP BẬT NHẬN ĐƠN */}
      {showPopup && canOnCall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4">
                <BellRing size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Xác nhận sẵn sàng</h3>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Khi có khách đặt lịch, bạn cần bao nhiêu phút để di chuyển từ nhà đến Spa?
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                    Thời gian di chuyển (Phút)
                  </label>
                  <div className="flex items-center gap-3 mb-6">
                    <button
                      onClick={() => setTempMins(tempMins <= 5 ? 60 : tempMins - 5)}
                      className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold active:scale-95"
                    >
                      -5
                    </button>
                    <div className="flex-1 h-12 rounded-2xl border-2 border-emerald-100 flex items-center justify-center text-xl font-black text-emerald-700">
                      {tempMins}
                    </div>
                    <button
                      onClick={() => setTempMins(tempMins >= 60 ? 5 : tempMins + 5)}
                      className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold active:scale-95"
                    >
                      +5
                    </button>
                  </div>

                  <div className="mb-4 text-center">
                    <p className="text-sm font-medium text-slate-600">
                      Bạn sẽ rảnh lúc: <span className="font-bold text-emerald-600">{getPreviewTime()}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">(Bây giờ + {tempMins} phút)</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                      Đến mấy giờ? (Tuỳ chọn)
                    </label>
                    <input 
                      type="time" 
                      value={expectedEnd}
                      onChange={(e) => setExpectedEnd(e.target.value)}
                      className="w-full h-12 rounded-2xl border-2 border-slate-100 px-3 font-bold text-slate-700 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowPopup(false)}
                    disabled={actionLoading}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-transform disabled:opacity-50"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={() => {
                      handleToggleOnCall(true, tempMins, expectedEnd);
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3.5 rounded-2xl bg-emerald-600 text-white font-bold active:scale-95 transition-transform shadow-lg shadow-emerald-200 disabled:opacity-50"
                  >
                    Bật Nhận Đơn
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
