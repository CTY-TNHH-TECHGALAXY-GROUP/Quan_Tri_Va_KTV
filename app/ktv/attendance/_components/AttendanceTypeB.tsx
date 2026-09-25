import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, BellRing, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

interface OnCallState {
  allow_on_call: boolean;
  is_on_call: boolean;
  online_status: 'ONLINE' | 'AT_VENUE' | 'OFFLINE';
  travel_time_mins: number;
}

interface Props {
  ktvId: string;
  checkStatus?: string;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onRefreshStatus?: () => void;
  incompleteTasksCount?: number;
}

export default function AttendanceTypeB({ ktvId, checkStatus, onCheckIn, onCheckOut, onRefreshStatus, incompleteTasksCount = 0 }: Props) {
  const [state, setState] = useState<OnCallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Popup Bật Nhận Đơn
  const [showPopup, setShowPopup] = useState(false);
  const [tempMins, setTempMins] = useState(30);
  const [expectedStart, setExpectedStart] = useState('');
  const [expectedEnd, setExpectedEnd] = useState('');

  const fetchState = async () => {
    try {
      const res = await apiClient.get<any>(`${API.KTV.ON_CALL}?techCode=${ktvId}`);
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
    if (ktvId) fetchState();
    const interval = setInterval(fetchState, 30000); // Polling every 30s
    return () => clearInterval(interval);
  }, [ktvId]);

  const handleToggleOnCall = async (isOnCall: boolean, mins: number, start?: string, end?: string) => {
    setActionLoading(true);
    try {
      const res = await apiClient.post<any>(API.KTV.ON_CALL, {
        techCode: ktvId,
        is_on_call: isOnCall,
        travel_time_mins: mins,
        expected_start: start,
        expected_end: end
      });
      if (res.success) {
        setShowPopup(false);
        await fetchState();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        alert(res.error || 'Có lỗi xảy ra');
      }
    } catch (e) {
      alert('Lỗi kết nối');
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

  if (!state?.allow_on_call) {
    return (
      <div className="bg-amber-50 p-6 rounded-2xl border border-amber-200 text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <p className="text-amber-800 font-bold">Tính năng không khả dụng</p>
        <p className="text-sm text-amber-600 mt-2">Bạn không được cấp quyền sử dụng chế độ Nhận Đơn.</p>
      </div>
    );
  }

  const isOnline = state.online_status === 'ONLINE';
  // Ngăn lỗi kẹt trạng thái AT_VENUE sang ngày mới: Chỉ khi đã điểm danh hôm nay mới tính là AT_VENUE.
  const isAtVenue = state.online_status === 'AT_VENUE' && checkStatus !== 'IDLE' && checkStatus !== 'CHECKED_OUT';
  const isOffline = (state.online_status === 'OFFLINE' || state.online_status === 'AT_VENUE') && !isOnline && !isAtVenue;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
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
            {isAtVenue ? 'ĐÃ TỚI TIỆM' : isOnline ? 'ĐANG CHỜ ĐƠN' : 'ĐANG TẮT'}
        </h3>
        <p className="text-sm font-medium text-slate-500">
            {isAtVenue ? 'Đã tới tiệm. Vui lòng bàn giao đồ và sẵn sàng nhận tour.' : 
             isOnline ? `Đang sẵn sàng từ nhà. Thời gian di chuyển: ${state.travel_time_mins} phút.` :
             'Chưa bật nhận đơn. Hãy bật khi bạn rảnh.'}
        </p>
      </div>

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
                <button
                    onClick={() => setShowPopup(true)}
                    disabled={actionLoading}
                    className="w-full py-4 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    <BellRing size={22} /> {actionLoading ? 'Đang xử lý...' : 'Bật Nhận Đơn'}
                </button>
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
                        if (incompleteTasksCount > 0) {
                          alert(`Bạn còn ${incompleteTasksCount} công việc chưa hoàn thành. Vui lòng hoàn thành trước khi Tắt Nhận Đơn.`);
                          return;
                        }
                        handleToggleOnCall(false, state.travel_time_mins);
                      }}
                      disabled={actionLoading || incompleteTasksCount > 0}
                      className="w-full py-4 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                      <LogOut size={22} className="rotate-180" /> {actionLoading ? 'Đang xử lý...' : 'Tắt Nhận Đơn'}
                  </button>
                  {incompleteTasksCount > 0 && (
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
                    if (incompleteTasksCount > 0) {
                      alert(`Bạn còn ${incompleteTasksCount} công việc chưa hoàn thành. Vui lòng hoàn thành trước khi tan ca.`);
                      return;
                    }
                    onCheckOut();
                  }}
                  disabled={actionLoading || incompleteTasksCount > 0}
                  className="w-full py-4 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-rose-200 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                  <LogOut size={22} /> {actionLoading ? 'Đang xử lý...' : 'Oria Xin cảm ơn'}
              </button>
              {incompleteTasksCount > 0 && (
                  <p className="text-red-500 text-xs text-center mt-2 font-medium">Bạn còn {incompleteTasksCount} công việc chưa hoàn thành. Không thể tan ca.</p>
              )}
             </div>
        )}
      </div>

      {/* POPUP BẬT NHẬN ĐƠN */}
      {showPopup && (
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

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                        Giờ rảnh dự kiến
                      </label>
                      <input 
                        type="time" 
                        value={expectedStart}
                        onChange={(e) => setExpectedStart(e.target.value)}
                        className="w-full h-12 rounded-2xl border-2 border-slate-100 px-3 font-bold text-slate-700 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                        Đến mấy giờ?
                      </label>
                      <input 
                        type="time" 
                        value={expectedEnd}
                        onChange={(e) => setExpectedEnd(e.target.value)}
                        className="w-full h-12 rounded-2xl border-2 border-slate-100 px-3 font-bold text-slate-700 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
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
                      handleToggleOnCall(true, tempMins, expectedStart, expectedEnd);
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
