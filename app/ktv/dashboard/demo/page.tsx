'use client';

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { 
  Clock, RefreshCw, CheckCircle2, Volume2, AlertTriangle, 
  Check, BookOpen, Users, Camera, RotateCcw, Play, CheckCircle, 
  ClipboardList, Image as ImageIcon, ChevronRight, Layers, ArrowRight,
  Eye, Heart, MicOff, AlertCircle, X
} from 'lucide-react';

export default function KTVDashboardDemoPage() {
  // Navigation tab: 'ORDER' | 'SETUP' | 'TIMER' | 'REVIEW'
  const [activeTab, setActiveTab] = useState<'ORDER' | 'SETUP' | 'TIMER' | 'REVIEW'>('REVIEW');
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const [selectedTraits, setSelectedTraits] = useState<string[]>(['Khách Dễ Thương']);

  // Controls parameters
  const [startTime, setStartTime] = useState('18:30');
  const [room, setRoom] = useState('VIP 2');
  const [bed, setBed] = useState('02');
  const [billCode, setBillCode] = useState('088-02102026-A');
  const [isTakeover, setIsTakeover] = useState(false);
  
  // 🔥 2 New Options Requested by User:
  const [hasCoWorkers, setHasCoWorkers] = useState(true); // Có KTV làm cùng
  const [hasAddonService, setHasAddonService] = useState(true); // Khách mua thêm dịch vụ (2 chặng)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<0 | 1>(0); // Đang làm Chặng 1 hay Chặng 2

  // Dịch vụ chính & dịch vụ thêm
  const mainService = {
    name: 'Massage Body Trị Liệu Cổ Vai Gáy',
    duration: 60,
    startTime: startTime,
    endTime: '19:30',
    room: room,
    bed: bed,
  };

  const addonService = {
    name: 'Gội Đầu Dưỡng Sinh Thảo Dược (Mua thêm)',
    duration: 30,
    startTime: '19:30',
    endTime: '20:00',
    room: room,
    bed: bed,
  };

  const currentSegment = hasAddonService && activeSegmentIndex === 1 ? addonService : mainService;
  const totalDuration = hasAddonService ? (mainService.duration + addonService.duration) : mainService.duration;

  // Interactive states for Setup tab
  const [checklist, setChecklist] = useState<boolean[]>([true, true, true, true, true]);
  const prepItems = [
    'Trải drap giường & khăn mới sạch sẽ',
    'Kiểm tra nhiệt độ phòng (24°C - 26°C)',
    'Chuẩn bị dầu massage & đá nóng chuyên dụng',
    'Châm nước bình thuỷ & chuẩn bị trà đón khách',
    'Kiểm tra ánh sáng dịu & âm nhạc thư giãn'
  ];

  // Interactive states for Timer tab
  const [photoSlipper, setPhotoSlipper] = useState<string | null>('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23059669"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="white" font-weight="bold">ẢNH DÉP KHÁCH</text></svg>');
  const [photoStart, setPhotoStart] = useState<string | null>('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23059669"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="white" font-weight="bold">ẢNH BẮT ĐẦU DV</text></svg>');
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(currentSegment.duration * 60);

  // Cập nhật lại số giây khi đổi chặng
  useEffect(() => {
    setSecondsRemaining(currentSegment.duration * 60);
    setIsTimerRunning(false);
  }, [activeSegmentIndex, hasAddonService]);

  // Web Audio Alert for Ding-Dong spa chime
  const playDingDong = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
      gain1.gain.setValueAtTime(0.25, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.setValueAtTime(830.61, ctx.currentTime + 0.16);
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.65);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.16);
      osc2.stop(ctx.currentTime + 0.65);
    } catch (e) {}

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]); } catch (e) {}
    }
  };

  const toggleChecklist = (index: number) => {
    setChecklist(prev => prev.map((v, i) => i === index ? !v : v));
  };

  const checkAllChecklist = () => {
    const allChecked = checklist.every(Boolean);
    setChecklist(new Array(prepItems.length).fill(!allChecked));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string | null) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (ev.target?.result) setter(ev.target.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSimulatePhoto = (type: 'slipper' | 'start') => {
    const dummyImage = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23059669"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="white" font-weight="bold">ẢNH ĐÃ CHỤP</text></svg>';
    if (type === 'slipper') setPhotoSlipper(dummyImage);
    else setPhotoStart(dummyImage);
  };

  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning && secondsRemaining > 0) {
      interval = setInterval(() => {
        setSecondsRemaining(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, secondsRemaining]);

  const formatTimerString = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const currentSegmentTotalSeconds = currentSegment.duration * 60;
  const timerProgress = currentSegmentTotalSeconds > 0 ? (secondsRemaining / currentSegmentTotalSeconds) * 100 : 0;

  return (
    <AppLayout title="Demo Giao Diện KTV">
      <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-6">
        {/* Banner hướng dẫn kiểm tra */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 rounded-3xl shadow-xl border border-indigo-800/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Layers className="text-amber-400 shrink-0" size={22} />
                <h1 className="text-lg sm:text-xl font-black tracking-tight">DEMO: KTV LÀM CÙNG &amp; 2 CHẶNG KHÁCH MUA THÊM DỊCH VỤ</h1>
              </div>
              <p className="text-xs text-indigo-200 leading-relaxed">
                Đang mô phỏng đúng tình huống bạn yêu cầu: Hiển thị <b>KTV làm cùng</b> trên Timer và lộ trình <b>2 chặng dịch vụ</b> (Massage 60p + Mua thêm Gội đầu 30p).
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={playDingDong}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <Volume2 size={16} />
                <span>Thử Chuông Ding-Dong 🔔</span>
              </button>
            </div>
          </div>

          {/* Controls tuỳ chỉnh nhanh */}
          <div className="mt-4 pt-4 border-t border-indigo-800/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {/* Toggle 1: Có KTV làm cùng */}
            <div className="flex flex-col justify-center bg-slate-950/80 border border-indigo-700/80 rounded-xl p-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-white">
                <input
                  type="checkbox"
                  checked={hasCoWorkers}
                  onChange={(e) => setHasCoWorkers(e.target.checked)}
                  className="rounded text-indigo-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-[11px] text-indigo-200">Có KTV làm cùng</span>
              </label>
              <span className="text-[10px] text-slate-400 ml-6">Cùng làm với T003, T008</span>
            </div>

            {/* Toggle 2: Khách mua thêm DV (2 chặng) */}
            <div className="flex flex-col justify-center bg-slate-950/80 border border-indigo-700/80 rounded-xl p-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-white">
                <input
                  type="checkbox"
                  checked={hasAddonService}
                  onChange={(e) => setHasAddonService(e.target.checked)}
                  className="rounded text-emerald-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-[11px] text-emerald-300">Khách mua thêm DV</span>
              </label>
              <span className="text-[10px] text-slate-400 ml-6">2 chặng (60p + 30p = 90p)</span>
            </div>

            {/* Selector: Chuyển Chặng 1 / Chặng 2 (chỉ khi có 2 chặng) */}
            {hasAddonService ? (
              <div className="flex flex-col justify-center bg-slate-950/80 border border-emerald-700/80 rounded-xl p-2">
                <span className="text-[10px] text-emerald-300 font-bold mb-1">Chặng đang thực hiện:</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveSegmentIndex(0)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      activeSegmentIndex === 0
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Chặng 1 (60p)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSegmentIndex(1)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      activeSegmentIndex === 1
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Chặng 2 (30p)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center bg-slate-950/80 border border-indigo-700/80 rounded-xl px-3 text-slate-400 text-xs">
                <span>Đơn 1 dịch vụ (60p)</span>
              </div>
            )}

            {/* Giờ bắt đầu */}
            <div className="flex flex-col justify-center bg-slate-950/80 border border-indigo-700/80 rounded-xl px-2.5 py-1.5">
              <label className="block text-[10px] font-bold text-indigo-300">Giờ bắt đầu:</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-transparent text-white font-bold text-xs focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Thanh Điều Hướng 4 Chặng Làm Việc (Workflow Tabs) */}
        <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('ORDER')}
            className={`flex-1 min-w-[120px] py-3 px-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'ORDER'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>🔔 1. Nhận Đơn</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SETUP')}
            className={`flex-1 min-w-[120px] py-3 px-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'SETUP'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>📋 2. Mở Phòng</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('TIMER')}
            className={`flex-1 min-w-[120px] py-3 px-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'TIMER'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-200'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>⏱️ 3. Timer</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('REVIEW')}
            className={`flex-1 min-w-[140px] py-3 px-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'REVIEW'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-200'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>🏁 4. Hoàn Tất (Xem Dép)</span>
          </button>
        </div>

        {/* ============================================================== */}
        {/* TAB 1: THẺ NHẬN ĐƠN BAN ĐẦU */}
        {/* ============================================================== */}
        {activeTab === 'ORDER' && (
          <div className="space-y-4">
            <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl text-xs text-indigo-900 flex items-center justify-between">
              <span className="font-medium">
                👉 Thẻ hiển thị khi có đơn điều phối. {hasAddonService ? 'Có 2 dịch vụ (gồm dịch vụ mua thêm).' : 'Đơn tiêu chuẩn 1 dịch vụ.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  playDingDong();
                  setActiveTab('SETUP');
                }}
                className="px-3 py-1 bg-indigo-600 text-white rounded-lg font-bold text-xs shrink-0 ml-2 cursor-pointer"
              >
                Giả lập Bấm Nhận Đơn ➔
              </button>
            </div>

            {/* THẺ NHẬN ĐƠN CHUẨN */}
            <div className="p-6 rounded-[32px] bg-white border border-slate-100 shadow-xl relative overflow-hidden">
              <div className="flex flex-col gap-4">
                {/* Header trạng thái */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Đơn mới điều phối</span>
                  <span className="text-[11px] font-bold text-slate-400">Vui lòng xác nhận</span>
                </div>

                {/* Tên dịch vụ & Subline */}
                <div>
                  <h3 className="font-black text-xl sm:text-2xl text-slate-800 leading-snug">
                    {hasAddonService ? (
                      <span className="flex flex-col gap-1">
                        <span>1. {mainService.name} (60p)</span>
                        <span className="text-emerald-700 text-lg font-bold flex items-center gap-1.5">
                          <Layers size={18} className="text-emerald-600 shrink-0" />
                          2. {addonService.name} (30p)
                        </span>
                      </span>
                    ) : (
                      mainService.name
                    )}
                  </h3>
                  <div className="flex items-center gap-2 mt-2 text-xs text-slate-500 font-semibold flex-wrap">
                    <span>Đơn {billCode}</span>
                    <span>•</span>
                    <span className="text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded">
                      Tổng {totalDuration} phút
                    </span>
                    {hasAddonService && (
                      <span className="text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                        2 Dịch vụ
                      </span>
                    )}
                    <span>•</span>
                    <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
                      <Clock size={13} /> Dự kiến {startTime}
                    </span>
                  </div>
                </div>

                {/* Khối Thông Số Cốt Lõi: Thanh Phòng & Giường chìm xuống khối xám nhẹ, có chữ như version cũ */}
                <div className="bg-slate-100/90 border border-slate-200/60 rounded-2xl p-3.5 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Phòng</p>
                    <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                      {room.startsWith('Phòng') ? room : `Phòng ${room}`}
                    </p>
                  </div>
                  <div className="border-l border-slate-200 pl-4">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Giường</p>
                    <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                      {bed.startsWith('Giường') ? bed : `Giường ${bed}`}
                    </p>
                  </div>
                </div>

                {/* Đồng đội cùng làm (Bỏ khung bao quanh) */}
                {hasCoWorkers && (
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-600 py-0.5">
                    <Users size={14} className="text-indigo-600 shrink-0" />
                    <span>Cùng làm với: <strong className="font-black text-indigo-700">T003, T008</strong> (Phục vụ đồng thời)</span>
                  </div>
                )}

                {/* Công thái học nút bấm */}
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => alert('Bật modal từ chối đơn với quy chế trừ quỹ giờ / trừ điểm.')}
                    className="py-4 bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-600 font-black rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all cursor-pointer"
                  >
                    TỪ CHỐI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playDingDong();
                      setActiveTab('SETUP');
                    }}
                    className="col-span-2 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Check size={18} strokeWidth={3} />
                    <span>NHẬN ĐƠN</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: MÀN HÌNH SAU KHI NHẬN ĐƠN (CHUẨN BỊ PHÒNG) */}
        {/* ============================================================== */}
        {activeTab === 'SETUP' && (
          <div className="space-y-6">
            {/* THẺ ĐƠN ĐANG THỰC HIỆN */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Đơn đang thực hiện</span>
                  <span className="text-[11px] font-bold text-slate-400">• Đơn {billCode}</span>
                </div>
                <button 
                  type="button"
                  onClick={() => alert('Hiển thị quy trình dịch vụ')}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs cursor-pointer"
                >
                  <ClipboardList size={14} /> Quy trình
                </button>
              </div>

              {/* Tên Dịch Vụ */}
              <div>
                <h3 className="font-black text-xl sm:text-2xl text-slate-800 leading-snug">
                  {hasAddonService ? (
                    <div className="space-y-1">
                      <div>{mainService.name} (60p)</div>
                      <div className="text-emerald-700 text-base font-bold flex items-center gap-1.5">
                        <Layers size={16} className="text-emerald-600" />
                        + {addonService.name} (30p)
                      </div>
                    </div>
                  ) : (
                    mainService.name
                  )}
                </h3>
                <div className="flex items-center gap-2 mt-2 text-xs text-slate-500 font-semibold flex-wrap">
                  <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-lg flex items-center gap-1">
                    <Clock size={12} /> Dự kiến {startTime}
                  </span>
                  <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg font-bold">
                    ⏱️ Tổng {totalDuration} phút
                  </span>
                  {hasAddonService && (
                    <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg font-bold">
                      2 Chặng
                    </span>
                  )}
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg font-bold">
                    Khách A
                  </span>
                </div>
              </div>

              {/* Khối Thông Số Cốt Lõi: Thanh Phòng & Giường chìm xuống khối xám nhẹ, có chữ như version cũ */}
              <div className="bg-slate-100/90 border border-slate-200/60 rounded-2xl p-3.5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Phòng</p>
                  <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                    {room.startsWith('Phòng') ? room : `Phòng ${room}`}
                  </p>
                </div>
                <div className="border-l border-slate-200 pl-4">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Giường</p>
                  <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                    {bed.startsWith('Giường') ? bed : `Giường ${bed}`}
                  </p>
                </div>
              </div>

              {/* Đồng đội cùng làm (Bỏ khung bao quanh) */}
              {hasCoWorkers && (
                <div className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-2 px-1">
                  <Users size={14} className="text-indigo-600 shrink-0" />
                  <span>Cùng làm với: <strong className="font-black text-indigo-700">T003, T008</strong> (Phục vụ đồng thời tại phòng {room})</span>
                </div>
              )}

              {/* Lộ Trình 2 Chặng Khi Khách Mua Thêm Dịch Vụ */}
              {hasAddonService && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Lộ trình thực hiện (2 Chặng)</span>
                    <span className="text-emerald-700 font-bold">Tổng 90 phút</span>
                  </h4>

                  <div className="space-y-2">
                    {/* Chặng 1 */}
                    <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                          1
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800">{mainService.name}</p>
                          <p className="text-[10px] font-semibold text-slate-500">
                            Phòng {room} • Giường {bed} • {mainService.duration} phút ({mainService.startTime} - {mainService.endTime})
                          </p>
                        </div>
                      </div>
                      <span className="text-[9px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-md shrink-0">
                        Chặng 1
                      </span>
                    </div>

                    {/* Chặng 2 */}
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-xl bg-slate-200 text-slate-600 font-black text-xs flex items-center justify-center shrink-0">
                          2
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800">{addonService.name}</p>
                          <p className="text-[10px] font-semibold text-slate-500">
                            Phòng {room} • Giường {bed} • {addonService.duration} phút ({addonService.startTime} - {addonService.endTime})
                          </p>
                        </div>
                      </div>
                      <span className="text-[9px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-md shrink-0">
                        Mua thêm
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Checklist Chuẩn Bị Phòng */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-700 flex items-center gap-2 uppercase text-xs tracking-wider">
                  <CheckCircle size={16} className="text-emerald-600" />
                  Quy trình chuẩn bị phòng
                </h3>
                <button 
                  type="button"
                  onClick={checkAllChecklist}
                  className="text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl active:scale-95 transition-all border border-emerald-100/80 shadow-2xs cursor-pointer"
                >
                  {checklist.every(Boolean) ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
              </div>

              <div className="space-y-2">
                {prepItems.map((label, idx) => (
                  <label 
                    key={idx} 
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                      checklist[idx] 
                        ? 'bg-emerald-50/60 border-emerald-200/80 text-emerald-900 font-medium' 
                        : 'bg-slate-50/60 border-slate-100 text-slate-700 hover:bg-slate-100/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checklist[idx]}
                      onChange={() => toggleChecklist(idx)}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs sm:text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Thao tác: Giữ nguyên nút báo sự cố phòng viền đỏ đứt nét */}
            <div className="space-y-3">
              <button
                type="button"
                disabled={!isTakeover && !checklist.every(Boolean)}
                onClick={() => setActiveTab('TIMER')}
                className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-white transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 ${
                  isTakeover || checklist.every(Boolean)
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50 cursor-pointer'
                    : 'bg-slate-300 shadow-none cursor-not-allowed'
                }`}
              >
                <Check size={18} strokeWidth={3} />
                <span>{isTakeover ? 'VÀO PHÒNG LÀM TIẾP' : 'XÁC NHẬN CHUẨN BỊ XONG (VÀO PHÒNG)'}</span>
              </button>

              <button
                type="button"
                onClick={() => alert('Mở popup báo sự cố phòng (Máy lạnh, Đèn, Giường...).')}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-rose-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-100/50 cursor-pointer"
              >
                <AlertTriangle size={16} />
                <span>Báo sự cố phòng</span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: MÀN HÌNH KHI MỞ PHÒNG / BẮT ĐẦU DỊCH VỤ (TIMER) */}
        {/* ============================================================== */}
        {activeTab === 'TIMER' && (
          <div className="space-y-6">
            {/* 1. HEADER CARD ĐỒNG BỘ CHUẨN SPA */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3.5">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Đang phục vụ</span>
                  <span className="text-[11px] font-bold text-slate-400">• Đơn {billCode}</span>
                </div>
                <button 
                  type="button"
                  onClick={() => alert('Mở xem quy trình kỹ thuật')}
                  className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                >
                  <BookOpen size={13} /> Quy trình
                </button>
              </div>

              {/* Tên dịch vụ & Thông số chặng */}
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                    {hasAddonService ? `Chặng ${activeSegmentIndex + 1}/2` : 'Dịch vụ chính'}
                  </span>
                  {hasAddonService && (
                    <span className="text-[11px] font-bold text-slate-500">
                      (Tổng 2 dịch vụ: {totalDuration} phút)
                    </span>
                  )}
                </div>

                <h1 className="text-xl sm:text-2xl font-black text-slate-800 leading-snug">
                  {currentSegment.name}
                </h1>
                
                <p className="text-xs font-semibold text-slate-500 mt-1 flex items-center gap-2">
                  <span>⏱️ Thời lượng chặng: {currentSegment.duration} phút</span>
                  <span>• 🕒 {currentSegment.startTime} - {currentSegment.endTime}</span>
                </p>
              </div>

              {/* Khối Phòng & Giường đồng bộ khung xám */}
              <div className="bg-slate-100/90 border border-slate-200/60 rounded-2xl p-3.5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Phòng</p>
                  <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                    {currentSegment.room.startsWith('Phòng') ? currentSegment.room : `Phòng ${currentSegment.room}`}
                  </p>
                </div>
                <div className="border-l border-slate-200 pl-4">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Giường</p>
                  <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
                    {currentSegment.bed.startsWith('Giường') ? currentSegment.bed : `Giường ${currentSegment.bed}`}
                  </p>
                </div>
              </div>

              {/* Đồng đội cùng làm (Bỏ khung bao quanh) */}
              {hasCoWorkers && (
                <div className="flex items-center gap-2 text-xs font-medium text-slate-600 pt-1">
                  <Users size={14} className="text-indigo-600 shrink-0" />
                  <span>Cùng làm với: <strong className="font-black text-indigo-700">T003, T008</strong> (Phục vụ đồng thời tại phòng)</span>
                </div>
              )}
            </div>

            {/* ⭐ YÊU CẦU 2: HIỂN THỊ CASE 2 CHẶNG KHI KHÁCH MUA THÊM DỊCH VỤ (WORKING TIMELINE) */}
            {hasAddonService && (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Layers size={15} className="text-emerald-600" />
                    <span>Lộ trình thực hiện (Khách mua thêm dịch vụ)</span>
                  </h3>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg">
                    Đang ở Chặng {activeSegmentIndex + 1}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {/* Chặng 1 */}
                  <div 
                    onClick={() => setActiveSegmentIndex(0)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      activeSegmentIndex === 0
                        ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                        : 'bg-slate-50/60 border-slate-100 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center shrink-0 ${
                        activeSegmentIndex === 0 ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {activeSegmentIndex > 0 ? <Check size={16} strokeWidth={3} /> : '1'}
                      </div>
                      <div>
                        <p className={`font-black text-xs ${activeSegmentIndex === 0 ? 'text-emerald-950' : 'text-slate-700'}`}>
                          {mainService.name}
                        </p>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                          Phòng {room} • Giường {bed} • {mainService.duration} phút ({mainService.startTime} - {mainService.endTime})
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {activeSegmentIndex === 0 ? (
                        <span className="text-[10px] font-black bg-emerald-600 text-white px-2 py-1 rounded-md animate-pulse">
                          ĐANG LÀM
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400">
                          Chặng 1
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Vạch nối lộ trình */}
                  <div className="flex justify-center -my-1">
                    <div className="w-0.5 h-3 bg-slate-200" />
                  </div>

                  {/* Chặng 2 (Mua thêm) */}
                  <div 
                    onClick={() => setActiveSegmentIndex(1)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      activeSegmentIndex === 1
                        ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                        : 'bg-slate-50/60 border-slate-100 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center shrink-0 ${
                        activeSegmentIndex === 1 ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'
                      }`}>
                        2
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`font-black text-xs ${activeSegmentIndex === 1 ? 'text-emerald-950' : 'text-slate-700'}`}>
                            {addonService.name}
                          </p>
                          <span className="text-[9px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                            Mua thêm
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                          Phòng {room} • Giường {bed} • {addonService.duration} phút ({addonService.startTime} - {addonService.endTime})
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {activeSegmentIndex === 1 ? (
                        <span className="text-[10px] font-black bg-emerald-600 text-white px-2 py-1 rounded-md animate-pulse">
                          ĐANG LÀM
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                          Chờ tiếp theo
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hướng dẫn chuyển chặng */}
                <div className="flex justify-between items-center pt-2 text-[11px] text-slate-400">
                  <span>💡 Bấm trực tiếp vào từng ô chặng ở trên để đổi chặng kiểm tra giao diện.</span>
                  <button
                    type="button"
                    onClick={() => setActiveSegmentIndex(prev => prev === 0 ? 1 : 0)}
                    className="text-emerald-600 font-bold hover:underline flex items-center gap-1"
                  >
                    <span>Chuyển sang Chặng {activeSegmentIndex === 0 ? '2' : '1'}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* 2. TIMER TRÒN SVG ĐẾM NGƯỢC (GIỮ NGUYÊN 100%) */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col items-center justify-center">
              <div className="relative w-60 h-60 sm:w-64 sm:h-64 flex items-center justify-center">
                {/* Vòng nền xám */}
                <div className="absolute inset-0 rounded-full border-[12px] border-slate-50 opacity-70"></div>
                
                {/* SVG Vòng tiến trình tròn */}
                <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-sm">
                  <circle
                    cx="128" cy="128" r="115" stroke="currentColor" strokeWidth="12" fill="transparent"
                    className={`${isTimerRunning ? 'text-emerald-500' : 'text-blue-400'} transition-all duration-1000 ease-linear shadow-inner`}
                    strokeDasharray={2 * Math.PI * 115}
                    strokeDashoffset={2 * Math.PI * 115 * (1 - timerProgress / 100)}
                    strokeLinecap="round"
                  />
                </svg>
                
                {/* Nội dung trung tâm */}
                <div className="text-center z-10 px-4">
                  <div className={`text-5xl sm:text-6xl font-black ${isTimerRunning ? 'text-slate-800' : 'text-blue-600'} tracking-tighter tabular-nums`}>
                    {formatTimerString(secondsRemaining)}
                  </div>
                  <div className={`mt-3 px-3.5 py-1.5 rounded-full border font-black text-[10px] tracking-widest uppercase flex items-center justify-center gap-1.5 ${
                    isTimerRunning
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : 'bg-blue-50 text-blue-700 border-blue-100'
                  }`}>
                    {isTimerRunning && <Clock size={12} className="animate-spin" />}
                    <span>{isTimerRunning ? `ĐANG LÀM CHẶNG ${activeSegmentIndex + 1}` : 'ĐỢI BẮT ĐẦU'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. KHỐI BẮT ĐẦU: ĐƠN 2 CHẶNG THÌ CHẶNG 2 KHÔNG CẦN CHỤP DÉP LẠI LẦN 2 */}
            {!isTimerRunning && (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-4">
                {activeSegmentIndex > 0 ? (
                  /* ĐƠN CÓ 2 CHẶNG: CHẶNG 2 MIỄN CHỤP DÉP, NHƯNG VẪN BẮT BUỘC CHỤP ẢNH BẮT ĐẦU */
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                        Chụp ảnh bắt đầu phục vụ Chặng {activeSegmentIndex + 1}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Khách đang trong phòng: <b>Miễn chụp lại dép</b>, nhưng KTV <b>vẫn phải chụp ảnh bắt đầu</b> chặng mới.
                      </p>
                    </div>

                    {/* Dép khách đã lưu từ chặng 1 - Hiển thị badge xác nhận */}
                    <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden border border-emerald-300 bg-white shrink-0">
                          <img 
                            src={photoSlipper || 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80'} 
                            alt="Dép khách" 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                        <div className="text-left">
                          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                            ✓ Đã có ảnh dép từ Chặng 1
                          </span>
                          <p className="text-xs font-black text-slate-800 mt-1">Dép khách chụp lúc bắt đầu đơn</p>
                          <p className="text-[11px] text-emerald-600 font-medium">Được miễn chụp lại dép ở Chặng {activeSegmentIndex + 1}</p>
                        </div>
                      </div>
                    </div>

                    {/* Ô: Ảnh bắt đầu dịch vụ chặng 2 (BẮT BUỘC CHỤP) */}
                    <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col justify-between space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          Ảnh bắt đầu DV Chặng {activeSegmentIndex + 1} (Bắt buộc)
                          {photoStart && <CheckCircle size={15} className="text-emerald-500 fill-emerald-100" />}
                        </span>
                        {photoStart && (
                          <button
                            type="button"
                            onClick={() => setPhotoStart(null)}
                            className="text-[10px] font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw size={11} /> Chụp lại
                          </button>
                        )}
                      </div>

                      {photoStart ? (
                        <div className="h-28 rounded-xl overflow-hidden border-2 border-emerald-500 relative shadow-xs">
                          <img src={photoStart} alt="Ảnh bắt đầu dịch vụ" className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded">✓ Đã có ảnh</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="w-full py-3.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer text-center">
                            <Camera size={16} />
                            <span>Chụp / Tải ảnh bắt đầu Chặng {activeSegmentIndex + 1}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handlePhotoUpload(e, setPhotoStart)}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => handleSimulatePhoto('start')}
                            className="w-full text-center text-[10px] text-slate-400 hover:text-indigo-600 py-1"
                          >
                            [Click để nạp ảnh mẫu test nhanh]
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Nút Bắt đầu phục vụ Chặng 2 (Yêu cầu phải có photoStart) */}
                    <button
                      type="button"
                      disabled={!photoStart}
                      onClick={() => setIsTimerRunning(true)}
                      className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-white transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 ${
                        photoStart
                          ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50 cursor-pointer'
                          : 'bg-slate-300 shadow-none cursor-not-allowed'
                      }`}
                    >
                      <Play size={18} fill="currentColor" />
                      <span>{photoStart ? `BẮT ĐẦU PHỤC VỤ CHẶNG ${activeSegmentIndex + 1}` : `CHỤP ẢNH BẮT ĐẦU ĐỂ TIẾP TỤC CHẶNG ${activeSegmentIndex + 1}`}</span>
                    </button>
                  </div>
                ) : (
                  /* Chặng 1: Bắt buộc chụp ảnh dép khách và ảnh bắt đầu */
                  <>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                        Chụp đủ 2 ảnh để mở khoá bắt đầu phục vụ chặng 1
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Bấm <b>&ldquo;Chụp / Tải ảnh&rdquo;</b> để chụp trực tiếp bằng camera hoặc chọn ảnh có sẵn từ thư viện máy.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Ô 1: Ảnh dép khách */}
                      <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            1. Ảnh dép khách
                            {photoSlipper && <CheckCircle size={15} className="text-emerald-500 fill-emerald-100" />}
                          </span>
                          {photoSlipper && (
                            <button
                              type="button"
                              onClick={() => setPhotoSlipper(null)}
                              className="text-[10px] font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw size={11} /> Chụp lại
                            </button>
                          )}
                        </div>

                        {photoSlipper ? (
                          <div className="h-28 rounded-xl overflow-hidden border-2 border-emerald-500 relative shadow-xs">
                            <img src={photoSlipper} alt="Ảnh dép khách" className="w-full h-full object-cover" />
                            <span className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded">✓ Đã có ảnh</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="w-full py-3.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer text-center">
                              <Camera size={16} />
                              <span>Chụp / Tải ảnh</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handlePhotoUpload(e, setPhotoSlipper)}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => handleSimulatePhoto('slipper')}
                              className="w-full text-center text-[10px] text-slate-400 hover:text-indigo-600 py-1"
                            >
                              [Click để nạp ảnh mẫu test nhanh]
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Ô 2: Ảnh bắt đầu dịch vụ */}
                      <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            2. Ảnh bắt đầu DV
                            {photoStart && <CheckCircle size={15} className="text-emerald-500 fill-emerald-100" />}
                          </span>
                          {photoStart && (
                            <button
                              type="button"
                              onClick={() => setPhotoStart(null)}
                              className="text-[10px] font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw size={11} /> Chụp lại
                            </button>
                          )}
                        </div>

                        {photoStart ? (
                          <div className="h-28 rounded-xl overflow-hidden border-2 border-emerald-500 relative shadow-xs">
                            <img src={photoStart} alt="Ảnh bắt đầu dịch vụ" className="w-full h-full object-cover" />
                            <span className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded">✓ Đã có ảnh</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="w-full py-3.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer text-center">
                              <Camera size={16} />
                              <span>Chụp / Tải ảnh</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handlePhotoUpload(e, setPhotoStart)}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => handleSimulatePhoto('start')}
                              className="w-full text-center text-[10px] text-slate-400 hover:text-indigo-600 py-1"
                            >
                              [Click để nạp ảnh mẫu test nhanh]
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Nút Bắt đầu phục vụ Chặng 1 */}
                    <button
                      type="button"
                      disabled={!photoSlipper || !photoStart}
                      onClick={() => setIsTimerRunning(true)}
                      className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-white transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 ${
                        photoSlipper && photoStart
                          ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50 cursor-pointer'
                          : 'bg-slate-300 shadow-none cursor-not-allowed'
                      }`}
                    >
                      <Play size={18} fill="currentColor" />
                      <span>{photoSlipper && photoStart ? 'BẮT ĐẦU PHỤC VỤ CHẶNG 1' : 'CHỤP ĐỦ 2 ẢNH ĐỂ BẮT ĐẦU'}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {isTimerRunning && (
              <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-3 text-emerald-800 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  <span>Đang đếm ngược Chặng {activeSegmentIndex + 1}: {currentSegment.name} ({currentSegment.duration}p).</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsTimerRunning(false);
                    setSecondsRemaining(currentSegment.duration * 60);
                  }}
                  className="px-3 py-1.5 bg-white border border-emerald-300 rounded-xl text-emerald-700 font-bold active:scale-95 transition-all cursor-pointer shadow-2xs shrink-0"
                >
                  Đặt lại Timer
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: MÀN HÌNH HOÀN TẤT ĐƠN & XEM LẠI ẢNH DÉP KHÁCH */}
        {/* ============================================================== */}
        {activeTab === 'REVIEW' && (
          <div className="space-y-4">
            <div className="p-4 bg-purple-50/70 border border-purple-100 rounded-2xl text-xs text-purple-900 flex items-center justify-between">
              <span className="font-medium">
                👉 Màn hình KTV khi kết thúc phục vụ (Dịch vụ hoàn tất). Đã thêm tính năng <b>Xem lại ảnh dép khách đã chụp</b> để KTV dễ dàng đối chiếu và trả đúng dép cho khách.
              </span>
            </div>

            <div className="p-5 pt-8 space-y-5 max-w-lg mx-auto bg-white border border-slate-200 rounded-3xl shadow-sm">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="text-emerald-500" size={36} />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Dịch vụ hoàn tất!</h2>
                <p className="text-sm text-slate-400 font-medium">Đánh giá hồ sơ khách hàng</p>
              </div>

              {/* Warning Banner */}
              <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3 shadow-xs">
                <div className="w-8 h-8 bg-rose-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="text-rose-500" size={16} />
                </div>
                <p className="text-xs font-black text-rose-700 leading-relaxed uppercase tracking-tight">
                  Nhắc khách kiểm tra lại điện thoại, ví tiền và nữ trang trước khi rời phòng
                </p>
              </div>

              {/* 🔥 XEM LẠI ẢNH DÉP KHÁCH ĐÃ CHỤP (BỎ KHUNG BAO QUANH) */}
              <div className="flex items-center justify-between gap-3 py-1 px-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedImageModal(photoSlipper || 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80')}
                    className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-slate-100 active:scale-95 transition-transform cursor-pointer border border-slate-200"
                    title="Bấm để phóng to ảnh dép"
                  >
                    <img 
                      src={photoSlipper || 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80'} 
                      alt="Ảnh dép khách" 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <Eye size={16} className="text-white" />
                    </div>
                  </button>
                  <div className="text-left">
                    <p className="text-xs font-bold text-slate-800">Ảnh dép khách đã chụp</p>
                    <p className="text-[11px] text-slate-400">Xem để lấy đúng dép trả khách</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedImageModal(photoSlipper || 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80')}
                  className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Eye size={14} />
                  <span>Xem ảnh</span>
                </button>
              </div>

              {/* Personality Categories — GIỮ NGUYÊN 100% 5 LOẠI TÍNH CÁCH VÀ ICON NHƯ PRODUCTION */}
              <div className="space-y-3">
                {[
                  {
                    id: 'de_xom',
                    label: 'Khách Dê Xồm',
                    subtitle: 'Thiếu tôn trọng KTV',
                    icon: <AlertTriangle size={20} />,
                    selectedStyle: 'bg-rose-50 border-rose-400 text-rose-700',
                    iconBg: 'bg-rose-100 text-rose-600',
                  },
                  {
                    id: 'ky_tinh',
                    label: 'Khách Kỹ Tính + Khó Chịu',
                    subtitle: 'Yêu cầu sự tinh tế',
                    icon: <AlertCircle size={20} />,
                    selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
                    iconBg: 'bg-slate-100 text-slate-500',
                  },
                  {
                    id: 'de_thuong',
                    label: 'Khách Dễ Thương',
                    subtitle: 'Thân thiện, cởi mở',
                    icon: <Heart size={20} />,
                    selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
                    iconBg: 'bg-slate-100 text-slate-500',
                  },
                  {
                    id: 'huong_noi',
                    label: 'Khách Hướng Nội',
                    subtitle: 'Thích yên tĩnh, ít nói',
                    icon: <MicOff size={20} />,
                    selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
                    iconBg: 'bg-slate-100 text-slate-500',
                  },
                  {
                    id: 'huong_ngoai',
                    label: 'Khách Hướng Ngoại',
                    subtitle: 'Thích giao lưu, kết nối',
                    icon: <Users size={20} />,
                    selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
                    iconBg: 'bg-slate-100 text-slate-500',
                  },
                ].map((cat) => {
                  const isSelected = selectedTraits.includes(cat.label);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedTraits(prev => prev.includes(cat.label) ? prev.filter(t => t !== cat.label) : [...prev, cat.label])}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all active:scale-[0.98] cursor-pointer ${
                        isSelected
                          ? cat.selectedStyle
                          : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? (cat.id === 'de_xom' ? 'bg-rose-200 text-rose-600' : 'bg-emerald-200 text-emerald-600')
                          : cat.iconBg
                      }`}>
                        {cat.icon}
                      </div>
                      <div className="text-left flex-1">
                        <p className="font-black text-sm">{cat.label}</p>
                        <p className={`text-xs font-medium mt-0.5 ${isSelected ? 'opacity-80' : 'text-slate-400'}`}>
                          {cat.subtitle}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => alert('Đã lưu đánh giá và chuyển sang bước Bàn giao phòng!')}
                  className="w-full py-3.5 rounded-2xl font-black text-sm shadow-lg transition-all active:scale-[0.97] bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700 cursor-pointer"
                >
                  Lưu hồ sơ & Chuyển sang Dọn phòng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL PHÓNG TO ẢNH DÉP */}
        {selectedImageModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setSelectedImageModal(null)}
          >
            <div className="relative max-w-sm w-full bg-slate-900 rounded-3xl p-4 flex flex-col items-center gap-3 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="w-full flex items-center justify-between text-white border-b border-slate-800 pb-2">
                <span className="font-black text-xs uppercase tracking-wider text-indigo-300">👟 Ảnh dép khách đã chụp</span>
                <button
                  type="button"
                  onClick={() => setSelectedImageModal(null)}
                  className="p-1.5 rounded-full bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="w-full h-80 rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-slate-800">
                <img src={selectedImageModal} alt="Phóng to ảnh dép" className="w-full h-full object-contain" />
              </div>
              <p className="text-[11px] text-slate-400">Bấm bên ngoài hoặc nút X góc trên để đóng</p>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
