import React, { useState, useEffect } from 'react';
import { BellRing, LogOut, LogIn, Loader2, AlertCircle } from 'lucide-react';
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
  isOffToday: boolean;
  onCheckIn: () => void;
  onStateChange?: (isOnCall: boolean) => void;
  onRefreshStatus?: () => void;
}

export const OnCallWidget: React.FC<Props> = ({ ktvId, isOffToday, onCheckIn, onStateChange, onRefreshStatus }) => {
  const [state, setState] = useState<OnCallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Popup States
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
        if (onStateChange) {
            onStateChange(res.data.is_on_call === true);
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
    const interval = setInterval(fetchState, 30000); // Polling 30s
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
        alert(res.error || 'Có lỗi xảy ra, vui lòng thử lại!');
      }
    } catch (e: any) {
      console.error(e);
      alert('Lỗi kết nối máy chủ, vui lòng thử lại!');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return null; // <div className="w-full text-center text-xs text-slate-400 py-2">Đang tải cấu hình...</div>;

  // Nếu KTV không được cấp quyền allow_on_call (cờ feature flag) -> Không render gì cả
  if (!state?.allow_on_call) {
      // DEBUG MODE ONLY:
      console.log("[OnCallWidget] state = ", state);
      return null;
  }

  const isOnline = state.is_on_call;

  return (
    <div className="w-full mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* ─── KHI ĐANG NHẬN ĐƠN (ONLINE) ─── */}
      {isOnline ? (
        <div className="w-full space-y-4">
          <div className="p-5 rounded-[24px] border bg-blue-50 border-blue-200 flex flex-col items-center text-center shadow-sm">
            <div className="w-12 h-12 rounded-full mb-3 flex items-center justify-center bg-blue-100 text-blue-600">
              <BellRing size={24} className="animate-pulse" />
            </div>
            <h3 className="text-lg font-black mb-1 text-blue-700">
              ĐANG CHỜ ĐƠN
            </h3>
            <p className="text-xs font-medium text-blue-600">
              Đang sẵn sàng từ nhà. Thời gian di chuyển: {state.travel_time_mins} phút.
            </p>
          </div>
          
          <button
            type="button"
            onClick={() => onCheckIn()}
            disabled={actionLoading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <LogIn size={22} /> {actionLoading ? 'Đang xử lý...' : 'Đã đến tiệm'}
          </button>
          
          <button
            type="button"
            onClick={() => handleToggleOnCall(false, state.travel_time_mins)}
            disabled={actionLoading}
            className="w-full py-4 bg-slate-200 hover:bg-slate-300 active:scale-95 text-slate-700 font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <LogOut size={22} className="rotate-180" /> {actionLoading ? 'Đang xử lý...' : 'Tắt Nhận Đơn'}
          </button>
        </div>
      ) : (
        /* ─── KHI ĐANG TẮT (OFFLINE) ─── */
        <div className="w-full">
            <button
                type="button"
                onClick={() => {
                    console.log("CLICKED BẬT NHẬN ĐƠN, isOffToday=", isOffToday);
                    if (isOffToday) {
                        setShowPopup(true);
                    }
                }}
                disabled={actionLoading || !isOffToday}
                className={`w-full py-4 font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2
                    ${isOffToday 
                        ? 'bg-blue-500 hover:bg-blue-600 active:scale-95 text-white shadow-md shadow-blue-200' 
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-80 border border-slate-200'
                    }`}
            >
                <BellRing size={22} /> {actionLoading ? 'Đang xử lý...' : 'Bật Nhận Đơn'}
            </button>
            {!isOffToday && (
                <p className="text-center text-xs text-slate-400 font-medium mt-2 flex items-center justify-center gap-1">
                    <AlertCircle size={12} /> Bạn chỉ được bật tính năng này vào Ngày OFF
                </p>
            )}
        </div>
      )}

      {/* ─── POPUP BẬT NHẬN ĐƠN ─── */}
      {showPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6 text-left">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-4">
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
                      type="button"
                      onClick={() => setTempMins(tempMins <= 5 ? 60 : tempMins - 5)}
                      className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold active:scale-95"
                    >
                      -5
                    </button>
                    <div className="flex-1 h-12 rounded-2xl border-2 border-blue-100 flex items-center justify-center text-xl font-black text-blue-700">
                      {tempMins}
                    </div>
                    <button
                      type="button"
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
                        className="w-full h-12 rounded-2xl border-2 border-slate-100 px-3 font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
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
                        className="w-full h-12 rounded-2xl border-2 border-slate-100 px-3 font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowPopup(false)}
                    disabled={actionLoading}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-transform disabled:opacity-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleToggleOnCall(true, tempMins, expectedStart, expectedEnd);
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold active:scale-95 transition-transform shadow-lg shadow-blue-200 disabled:opacity-50"
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
