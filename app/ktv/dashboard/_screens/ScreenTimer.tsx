'use client';
import { isKtvDisplaySegment, ktvServiceName, parseKtvSegments, ktvAssignedMinutes } from '@/lib/ktvUtils';

import React, { useState, Suspense } from 'react';
import { API } from '@/lib/api-endpoints';
import { roomLabel } from '@/lib/room-label';
import { coWorkersOf } from '@/lib/co-workers';
import { ActionGridButton, ChecklistItem, RatingCard, CollapsibleRequirements } from '../_shared/components';
import { AlertCircle, AlertTriangle, BellRing, BookOpen, Camera, CheckCircle, Clock, Coffee, HelpCircle, Image as ImageIcon, Info, LogOut, Play, PlusSquare, RefreshCw, RotateCcw, ShieldAlert, Users } from 'lucide-react';
import { THEME, ANIMATION, DEFAULT_BOOKING_URL, formatMultiServiceNames, WebBookingQR, ServiceTypeLabel } from '../_shared/ui';
import { apiClient } from '@/lib/apiClient';
import { compressImageWithWatermark } from '@/lib/camera.logic';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '@/components/ui/Toast';
import { ShiftExtensionModal } from '@/app/ktv/_components/ShiftExtensionModal';

export function WorkingTimeline({ segments, activeIndex, shouldMerge, totalAssignedMins }: { segments: any[], activeIndex?: number, shouldMerge?: boolean, totalAssignedMins?: number }) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const clock = (value: any, offset = 0): string => {
    if (!value) return '—';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value))) {
      const [h, m] = String(value).split(':').map(Number);
      const minutes = ((h * 60 + m + offset) % 1440 + 1440) % 1440;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Date(date.getTime() + offset * 60000).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }) : '—';
  };
  // shouldMerge alone is a suggestion until START has persisted the run membership.
  const merged = shouldMerge && segments.length > 1 && segments.every(seg => seg.isMergedRun && seg.actualStartTime)
    && new Set(segments.map(seg => seg.mergedRunId || seg.actualStartTime)).size === 1;
  const displaySegments = merged ? [{ ...segments[0],
    duration: totalAssignedMins || segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0),
    actualEndTime: segments.every(seg => seg.actualEndTime) ? segments[segments.length - 1].actualEndTime : undefined,
    plannedEndAt: segments[segments.length - 1].plannedEndAt,
    endTime: segments[segments.length - 1].endTime,
  }] : segments;
  const segmentsWithTimes = displaySegments.map(seg => ({
    seg,
    displayStartTime: clock(seg.plannedStartAt || seg.startTime),
    displayEndTime: clock(seg.plannedEndAt || seg.endTime),
    actualText: seg.actualStartTime ? `Thực tế ${clock(seg.actualStartTime)} → ${seg.actualEndTime
      ? clock(seg.actualEndTime) : `${clock(seg.actualStartTime, Number(seg.duration) || 0)} (dự kiến kết thúc)`}` : '',
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between">
        <span>Lộ trình thực hiện</span>
        {activeIndex !== undefined && <span className="text-emerald-600">Chặng {activeIndex + 1}</span>}
      </h3>
      <div className="space-y-2">
        {segmentsWithTimes.map(({ seg, displayStartTime, displayEndTime, actualText }, idx) => {
          const isActive = merged ? activeIndex !== undefined : idx === activeIndex;
          const isPast = merged ? false : (activeIndex !== undefined && idx < activeIndex);

          return (
            <motion.div 
              key={`${seg.id}-${idx}`} 
              animate={{ 
                scale: isActive ? 1.02 : 1,
                opacity: isPast ? 0.6 : 1
              }}
              className={`relative flex items-center gap-4 p-3 rounded-2xl border transition-all ${
                isActive 
                  ? 'bg-emerald-50 border-emerald-200 shadow-md shadow-emerald-100/50' 
                  : 'bg-slate-50/50 border-slate-100/50'
              }`}
            >
              <div className="flex flex-col items-center w-10">
                <span className={`text-[10px] font-black ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>{displayStartTime}</span>
                <div className={`w-0.5 h-4 my-0.5 ${isActive ? 'bg-emerald-200' : 'bg-slate-200'}`} />
                <span className={`text-[10px] font-black ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}>{displayEndTime}</span>
              </div>
              <div className="flex-1">
                <p className={`text-xs font-black ${isActive ? 'text-emerald-900' : 'text-slate-800'}`}>
                  Phòng {roomLabel(seg.roomId)}
                  <span className="ml-2 text-[9px] font-normal">Giờ phân công</span>
                  {isActive && <span className="ml-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-md animate-pulse">ĐANG LÀM</span>}
                </p>
                <p className={`text-[10px] font-bold uppercase tracking-tighter ${isActive ? 'text-emerald-600/70' : 'text-slate-400'}`}>
                  {actualText && <span className="block normal-case">{actualText}</span>}
                  Giường {seg.bedId?.split('-').pop()} • {seg.duration} phút {merged && '(Gộp)'}
                </p>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition-colors ${
                isActive 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' 
                  : isPast ? 'bg-slate-200 text-slate-400' : 'bg-white text-slate-300 border border-slate-100'
              }`}>
                {isPast ? <CheckCircle size={14} /> : idx + 1}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function ScreenTimer({ logic }: { logic: any }) {
  const { addToast } = useToast();
  const { 
    booking, 
    timeRemaining, 
    prepTimeRemaining, 
    isPrepping, 
    isTimerRunning, 
    isPaused,
    handleStartTimer, 
    handleFinishTimer, 
    handleEarlyExit,
    handleInteraction,
    activeSegmentIndex
  } = logic;

  const [showExtensionModal, setShowExtensionModal] = useState(false);

  // 📸 CAMERA WEBRTC STATE & LOGIC FOR START TIMER
  const MIN_BRIGHTNESS_FALLBACK = 40;
  const [minBrightness, setMinBrightness] = React.useState(MIN_BRIGHTNESS_FALLBACK);

  React.useEffect(() => {
      apiClient.get<any>(API.KTV.SETTINGS)
          .then(json => {
              if (json.data?.min_photo_brightness !== undefined) {
                  setMinBrightness(Number(json.data.min_photo_brightness));
              }
          })
          .catch(() => { /* use fallback */ });
  }, []);

  const handleProcessPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string | null) => void,
    label: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressed = await compressImageWithWatermark(file, {
        minBrightness,
        watermarkText: `${label} - Room ${booking?.assignedRoomId || booking?.roomName || ''}`
      });
      setter(compressed);
    } catch (err: any) {
      if (err?.message === 'TOO_DARK') {
        addToast('⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi có đủ ánh sáng.', 'error');
      } else {
        const reader = new FileReader();
        reader.onload = ev => {
          const result = ev.target?.result as string;
          if (result) setter(result);
        };
        reader.readAsDataURL(file);
      }
    }

    e.target.value = '';
  };

  const handleSlipperFileUpload = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleProcessPhoto(e, logic.setGuestSlipperPhotoBase64, 'Dép khách');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleProcessPhoto(e, logic.setStartPhotoBase64, 'Bắt đầu dịch vụ');

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const currentSecs = isPrepping ? prepTimeRemaining : timeRemaining;
  
  // Lấy tất cả DV mà KTV này được gán (hỗ trợ multi-item)
  const allTimerItemIds: string[] = booking?.assignedItemIds?.length > 0
    ? booking.assignedItemIds
    : (booking?.assignedItemId ? [booking.assignedItemId] : []);
  const allTimerItemsRaw = allTimerItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => allTimerItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  // 🔥 Filter out merged child items
  const hasTimerMergedChildren = allTimerItemsRaw.some((i: any) => i.options?.mergedIntoId);
  const allTimerItems = hasTimerMergedChildren
    ? allTimerItemsRaw.filter((i: any) => !i.options?.mergedIntoId)
    : allTimerItemsRaw;
  const item = allTimerItems[0] || {};
  // Tên: lấy danh sách tên từ TẤT CẢ các item (kể cả item con đã gộp) để UI Timer biết có bao nhiêu dịch vụ
  const allTimerServiceNames = allTimerItemsRaw.map((i: any) => ktvServiceName(i, logic.ktvId)).filter(Boolean);
  
  // Segments: dùng allTimerItemsRaw để tính tổng duration chính xác
  const allTimerKtvSegments = allTimerItemsRaw.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = parseKtvSegments(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = parseKtvSegments(i.segments);
    }
    return segs
      .filter((s: any) => isKtvDisplaySegment(s, logic.ktvId))
      .map((s: any) => {
        return { ...s, _itemId: i.id, _serviceName: ktvServiceName(i, logic.ktvId) };
      });
  }).sort((a: any, b: any) => {
      const timeA = a.startTime || '23:59';
      const timeB = b.startTime || '23:59';
      return timeA.localeCompare(timeB);
  });
  // Khi đã gộp, chỉ dùng segments từ item cha cho UI
  const ktvSegments = hasTimerMergedChildren
    ? allTimerKtvSegments.filter((s: any) => allTimerItems.some((i: any) => i.id === s._itemId))
    : allTimerKtvSegments;
  
  const uniqueItemIds = new Set(ktvSegments.map((s: any) => s._itemId));
  const uniqueRoomIds = new Set(ktvSegments.map((s: any) => s.roomId || `no-room:${s.id}`));
  const hasFinishedSegment = ktvSegments.some((s: any) => s.actualEndTime);
  const allFinished = ktvSegments.length > 0 && ktvSegments.every((s: any) => s.actualEndTime);
  const isFinishedMerge = allFinished && ktvSegments[0].actualEndTime === ktvSegments[ktvSegments.length - 1].actualEndTime;
  const shouldMerge = hasTimerMergedChildren || (ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length && uniqueRoomIds.size === 1 && !hasFinishedSegment);

  const totalAssignedMins = allTimerItemsRaw.reduce((sum: number, i: any) => sum + ktvAssignedMinutes(i, logic.ktvId), 0);
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;
  const nextSeg = ktvSegments.length > (activeSegmentIndex + 1) && !shouldMerge ? ktvSegments[activeSegmentIndex + 1] : null;

  // 🕒 CHỈ HIỂN THỊ THỜI GIAN CỦA CHẶNG HIỆN TẠI (trừ phi được gộp)
  const displayDuration = shouldMerge ? totalAssignedMins : (currentSeg ? Math.max(0, Number(currentSeg.duration) || 0) : ktvAssignedMinutes(item, logic.ktvId));

  const parsedSetup = Number(logic.settings?.ktv_setup_duration_minutes);
  const setupMins = !isNaN(parsedSetup) ? parsedSetup : 0;
  
  const totalDuration = isPrepping 
    ? setupMins * 60 
    : displayDuration * 60;
  
  // 🔄 Reverse progress: Start full (100) and move to 0 as time runs out
  const progress = totalDuration > 0 ? (currentSecs / totalDuration) * 100 : 0;

  // Xử lý hiển thị giờ bắt đầu / kết thúc
  const startTimeRaw = currentSeg
    ? currentSeg.actualStartTime || currentSeg.plannedStartAt || currentSeg.startTime || null
    : booking?.dispatchStartTime || booking?.timeStart || null;
  const getFormattedTime = (dateString: string | null) => {
    if (!dateString) return '--:--';
    if (typeof dateString === 'string' && /^\d{1,2}:\d{2}/.test(dateString)) return dateString.substring(0, 5);
    const d = new Date(dateString.includes('Z') || dateString.includes('+') ? dateString : dateString.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };
  const getEndTime = (dateString: string | null, durationMins: number) => {
    if (!dateString) return '--:--';
    let d = new Date(dateString.includes('Z') || dateString.includes('+') ? dateString : dateString.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) {
      if (typeof dateString === 'string' && /^\d{1,2}:\d{2}/.test(dateString)) {
        const [h, m] = dateString.split(':').map(Number);
        d = new Date();
        d.setHours(h, m + durationMins, 0, 0);
        return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      }
      return '--:--';
    }
    d.setMinutes(d.getMinutes() + durationMins);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const displayStartTime = getFormattedTime(startTimeRaw);
  const displayEndTime = getEndTime(startTimeRaw, displayDuration);


  return (
    <div className="p-4 md:p-8 h-full flex flex-col pt-8 md:pt-12 md:max-w-4xl md:mx-auto w-full">
      {/* Header Info */}
      <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex justify-between items-start gap-3">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                {ktvSegments.length > 1 && !shouldMerge ? `Chặng ${activeSegmentIndex + 1}/${ktvSegments.length}` : 'Dịch vụ'}
              </span>
              <ServiceTypeLabel serviceId={item.serviceId} />
              {booking?.billCode && (
                <span className="text-xs font-black text-slate-400">#{booking.billCode}</span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-black text-slate-800 leading-tight tracking-tight flex items-center gap-2 flex-wrap break-words">
              {item.guest_label && (
                 <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-base sm:text-lg flex items-center gap-1 shrink-0 border border-emerald-200">
                   👨 {item.guest_label}
                 </span>
              )}
              <span className="min-w-0 break-words">{allTimerServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : ktvServiceName(item, logic.ktvId)}</span>
            </h1>

            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold mt-1 flex-wrap">
              <span className="text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded-md">⏱️ {displayDuration} phút</span>
              <span>•</span>
              <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">🕒 {displayStartTime} - {displayEndTime}</span>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            {isTimerRunning && (
              <button 
                onClick={() => logic.forceRefresh?.()}
                className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 active:scale-90 transition-all shrink-0 cursor-pointer"
                title="Tải lại"
              >
                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200 shadow-sm">
                  <RefreshCw size={18} />
                </div>
                <span className="text-[9px] font-black uppercase tracking-tighter">Tải lại</span>
              </button>
            )}
            <button 
              onClick={() => logic.setShowProcedure(true)}
              className="flex flex-col items-center gap-1 text-emerald-600 hover:text-emerald-700 active:scale-90 transition-all shrink-0 cursor-pointer"
              title="Quy trình"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-sm">
                <BookOpen size={18} />
              </div>
              <span className="text-[9px] font-black uppercase tracking-tighter">Quy trình</span>
            </button>
          </div>
        </div>

        {/* Khối Thông Số Cốt Lõi: Thanh Phòng & Giường chìm xuống khối xám nhẹ đồng bộ */}
        <div className="bg-slate-100/90 border border-slate-200/60 rounded-2xl p-3.5 grid grid-cols-2 gap-3 text-sm mt-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Phòng</p>
            <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
              {(() => {
                const val = roomLabel(currentSeg?.roomId || booking?.assignedRoomId || item.roomName || booking?.roomName) || '—';
                return val.startsWith('Phòng') || val === '—' ? val : `Phòng ${val}`;
              })()}
            </p>
          </div>
          <div className="border-l border-slate-200 pl-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Giường</p>
            <p className="font-black text-slate-800 text-base sm:text-lg mt-0.5 truncate">
              {(() => {
                const raw = (currentSeg?.bedId || booking?.assignedBedId);
                const val = raw ? String(raw).split('-').pop() : '—';
                return !val || val === '—' || val.startsWith('Giường') ? (val || '—') : `Giường ${val}`;
              })()}
            </p>
          </div>
        </div>

        {/* CoWorkers display in Timer */}
        {(() => {
          const timerAssignedItem = booking?.assignedItemId
            ? booking.BookingItems?.find((bi: any) => bi.id === booking.assignedItemId)
            : null;
          const timerCoWorkers = coWorkersOf(timerAssignedItem, logic.ktvId);
          return timerCoWorkers.length > 0 ? (
            <div className="mt-2.5 text-xs font-medium text-slate-600 flex items-center justify-center gap-2">
              <Users size={14} className="text-indigo-600 shrink-0" />
              <span>Cùng làm với: <strong className="font-black text-indigo-700">{timerCoWorkers.join(', ')}</strong></span>
            </div>
          ) : null;
        })()}
      </div>

      {/* Rejected Handover Alert */}
      {item?.handover_status === 'REJECTED' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mx-2 mb-6 p-4 rounded-3xl bg-rose-50 border border-rose-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2 text-rose-700">
            <AlertTriangle size={18} />
            <h3 className="font-bold text-sm uppercase tracking-widest">Lễ tân yêu cầu dọn lại</h3>
          </div>
          {item?.handover_comment && (
            <p className="text-sm font-medium text-rose-800 bg-white p-3 rounded-2xl mb-3 border border-rose-100 shadow-sm">
              &ldquo;{item.handover_comment}&rdquo;
            </p>
          )}
          {item?.handover_reject_images && Array.isArray(item.handover_reject_images) && item.handover_reject_images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.handover_reject_images.map((url: string, idx: number) => (
                <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-rose-200 bg-white shadow-sm flex-shrink-0 cursor-pointer" onClick={() => window.open(url, '_blank')}>
                  <img src={url} alt={`Reject ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Main Timer Display */}
      <div className="flex flex-col items-center justify-center pb-8">
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Subtle Background Ring (always there) */}
          <div className="absolute inset-0 rounded-full border-[12px] border-slate-50 opacity-50"></div>
          
          <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-sm">
            <circle
              cx="128" cy="128" r="115" stroke="currentColor" strokeWidth="12" fill="transparent"
              className={`${isPaused ? 'text-amber-500' : isPrepping ? 'text-blue-400' : 'text-emerald-500'} transition-all duration-1000 ease-linear shadow-inner`}
              strokeDasharray={2 * Math.PI * 115}
              strokeDashoffset={2 * Math.PI * 115 * (1 - progress / 100)}
              strokeLinecap="round"
            />
          </svg>
          
          <div className="text-center z-10">
            <div className={`text-6xl font-black ${isPaused ? 'text-amber-500' : isPrepping ? 'text-blue-600' : 'text-slate-800'} tracking-tighter tabular-nums`}>
              {formatTime(currentSecs)}
            </div>
            <div className={`mt-3 px-4 py-1.5 rounded-full border font-black text-[10px] tracking-widest uppercase flex items-center justify-center gap-1.5
              ${isPaused ? 'bg-amber-50 text-amber-600 border-amber-200' : isPrepping ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {isPrepping && !isPaused && <Clock size={12} className="animate-pulse" />}
              {isPaused ? <><AlertCircle size={12} /> ĐANG TẠM DỪNG</> : isPrepping ? 'THỜI GIAN CHUẨN BỊ' : (isTimerRunning ? 'ĐANG THỰC HIỆN' : 'ĐỢI BẮT ĐẦU')}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline for multi-stage */}
      {ktvSegments.length > 0 && (
        <div className="px-2 mb-8">
          <WorkingTimeline 
            segments={ktvSegments} 
            activeIndex={activeSegmentIndex} 
            shouldMerge={shouldMerge}
            totalAssignedMins={totalAssignedMins}
          />
        </div>
      )}



      {/* Special Requirements Section (Note của khách hàng & Admin/Quầy) */}
      <div className="px-2 mb-6">
        <CollapsibleRequirements booking={booking} />
      </div>

      {/* Shift Extension Block */}
      <div className="px-2 mb-6">
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Clock size={20} className="text-indigo-600 shrink-0" />
            <div>
              <span className="text-sm font-bold text-slate-700">Giờ tan ca: </span>
              <span className="text-sm font-black text-indigo-700">
                {logic.shiftExtension?.currentEndTime || '--:--'}
              </span>
              {logic.shiftExtension?.used && (
                <span className="ml-1.5 px-2 py-0.5 text-xs font-bold bg-purple-100 text-purple-700 rounded-md">
                  Đã dùng lượt gia hạn
                </span>
              )}
            </div>
          </div>
          {logic.shiftExtension?.used ? (
            <button
              type="button"
              disabled
              className="px-4 py-2 text-sm font-bold text-slate-400 bg-slate-100 rounded-xl cursor-not-allowed border border-slate-200"
            >
              Đã dùng lượt gia hạn
            </button>
          ) : logic.shiftExtension?.canExtend ? (
            <button
              type="button"
              onClick={() => setShowExtensionModal(true)}
              className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm active:scale-95"
            >
              Gia hạn
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="px-4 py-2 text-sm font-bold text-slate-400 bg-slate-100 rounded-xl cursor-not-allowed border border-slate-200"
              title={logic.shiftExtension?.deadlineReached ? 'Đã quá giờ gia hạn' : !logic.shiftExtension?.currentEndTime ? 'Chưa có giờ tan ca' : 'Không thể gia hạn'}
            >
              {logic.shiftExtension?.deadlineReached ? 'Đã quá giờ gia hạn' : 'Gia hạn'}
            </button>
          )}
        </div>
      </div>

      {/* Primary Action Button */}
      {((!isTimerRunning && !isPaused) || isPrepping) ? (
        <div className="px-4 sm:px-6 mb-10">
          {activeSegmentIndex > 0 ? (
            /* Chặng tiếp theo (Chặng 2+): Miễn chụp dép, nhưng VẪN BẮT BUỘC chụp ảnh bắt đầu dịch vụ */
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
                      src={logic.resolvedGuestSlipperPhoto || logic.guestSlipperPhotoBase64 || ''} 
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

              {/* Ô: Ảnh bắt đầu dịch vụ chặng mới (BẮT BUỘC) */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    Ảnh bắt đầu DV Chặng {activeSegmentIndex + 1} (Bắt buộc)
                    {logic.startPhotoBase64 && <CheckCircle size={14} className="text-emerald-500 fill-emerald-100" />}
                  </span>
                  {logic.startPhotoBase64 && (
                    <button
                      type="button"
                      onClick={() => logic.setStartPhotoBase64(null)}
                      className="text-[10px] font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw size={12} />
                      Chụp lại
                    </button>
                  )}
                </div>

                {logic.startPhotoBase64 ? (
                  <img
                    src={logic.startPhotoBase64}
                    alt="Ảnh bắt đầu dịch vụ"
                    className="w-24 h-24 rounded-xl object-cover border-2 border-emerald-500 shadow-sm"
                  />
                ) : (
                  <label className={`w-full py-3.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-sm text-center ${
                    logic.canStart
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200/50'
                      : 'bg-slate-200 text-slate-400'
                  }`}>
                    <Camera size={16} />
                    <span>Chụp / Tải ảnh bắt đầu Chặng {activeSegmentIndex + 1}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={logic.isLoading || !logic.canStart}
                    />
                  </label>
                )}
              </div>

              {/* Nút Bắt đầu phục vụ Chặng 2 (Chỉ mở khoá khi đã có ảnh bắt đầu) */}
              {logic.startPhotoBase64 ? (
                <button
                  onClick={handleStartTimer}
                  disabled={logic.isLoading || !logic.canStart}
                  className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-lg shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-3 transition-all disabled:opacity-40 cursor-pointer"
                >
                  <Play fill="white" size={24} />
                  {logic.isLoading ? 'ĐANG BẮT ĐẦU...' : `BẮT ĐẦU PHỤC VỤ CHẶNG ${activeSegmentIndex + 1}`}
                </button>
              ) : (
                <button type="button" disabled className="w-full h-14 bg-slate-100 text-slate-400 font-bold text-sm rounded-2xl cursor-not-allowed border border-slate-200 flex items-center justify-center gap-2">
                  <Camera size={18} /> Chụp ảnh bắt đầu để tiếp tục Chặng {activeSegmentIndex + 1}
                </button>
              )}
              {!logic.canStart && logic.allowedStartTime && (
                <p className="text-center text-amber-700 font-black text-[11px] bg-amber-50 py-2 rounded-xl border border-amber-100 flex items-center justify-center gap-1.5">
                  <Clock size={12} strokeWidth={3} />
                  Chặng {activeSegmentIndex + 1} bắt đầu lúc {logic.allowedStartTime.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          ) : (
            /* Chặng 1: ảnh dép (dùng lại nếu đơn đã có — lượt B / người vào thay) + ảnh bắt đầu */
            <div className="space-y-4">
              {logic.inheritedSlipperUrl && (
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-emerald-300 bg-white shrink-0">
                    <img src={logic.inheritedSlipperUrl} alt="Dép khách" className="w-full h-full object-cover" />
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                      ✓ Đã có ảnh dép của khách
                    </span>
                    <p className="text-[11px] text-emerald-600 font-medium mt-1">Không cần chụp lại dép — chỉ chụp ảnh bắt đầu của bạn.</p>
                  </div>
                </div>
              )}
              {[
                ...(logic.inheritedSlipperUrl ? [] : [{
                  label: 'Ảnh dép khách',
                  value: logic.guestSlipperPhotoBase64,
                  setter: logic.setGuestSlipperPhotoBase64,
                  onChange: handleSlipperFileUpload
                }]),
                {
                  label: 'Ảnh bắt đầu dịch vụ',
                  value: logic.startPhotoBase64,
                  setter: logic.setStartPhotoBase64,
                  onChange: handleFileUpload
                }
              ].map((photo, index) => (
                <div key={photo.label} className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      {index + 1}. {photo.label}
                      {photo.value && <CheckCircle size={14} className="text-emerald-500 fill-emerald-100" />}
                    </span>

                    {photo.value && (
                      <button
                        type="button"
                        onClick={() => photo.setter(null)}
                        className="text-[10px] font-bold text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw size={12} />
                        Chụp lại
                      </button>
                    )}
                  </div>

                  {photo.value ? (
                    <img
                      src={photo.value}
                      alt={photo.label}
                      className="w-24 h-24 rounded-xl object-cover border-2 border-emerald-500 shadow-sm"
                    />
                  ) : (
                    <label className={`w-full py-3.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-sm text-center ${
                      logic.canStart
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200/50'
                        : 'bg-slate-200 text-slate-400'
                    }`}>
                      <Camera size={16} />
                      <span>Chụp / Tải ảnh</span>
                      <input
                        type="file" aria-label={`Chụp ${photo.label.toLowerCase()}`}
                        accept="image/*"
                        className="hidden"
                        onChange={photo.onChange}
                        disabled={logic.isLoading || !logic.canStart}
                      />
                    </label>
                  )}
                </div>
              ))}

              {(logic.guestSlipperPhotoBase64 || logic.inheritedSlipperUrl) && logic.startPhotoBase64 ? (
                <button
                  onClick={handleStartTimer}
                  disabled={logic.isLoading || !logic.canStart}
                  className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-lg shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-3 transition-all disabled:opacity-40 cursor-pointer"
                >
                  <Play fill="white" size={24} />
                  {logic.isLoading ? 'ĐANG BẮT ĐẦU...' : 'BẮT ĐẦU PHỤC VỤ'}
                </button>
              ) : (
                <button type="button" disabled className="w-full h-14 bg-slate-100 text-slate-400 font-bold text-sm rounded-2xl cursor-not-allowed border border-slate-200 flex items-center justify-center gap-2">
                  <Camera size={18} /> {logic.inheritedSlipperUrl ? 'Chụp ảnh bắt đầu để bắt đầu' : 'Chụp đủ 2 ảnh để bắt đầu'}
                </button>
              )}

              {!logic.canStart && logic.allowedStartTime && (
                <motion.p 
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center text-rose-600 font-black text-[11px] bg-rose-50 py-2 rounded-xl border border-rose-100 flex items-center justify-center gap-1.5"
                >
                  <Clock size={12} strokeWidth={3} />
                  Bạn có thể bắt đầu lúc {logic.allowedStartTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </motion.p>
              )}
            </div>
          )}
        </div>
      ) : logic.booking?.nextBookingId ? (
        <div className="px-6 mb-6">
          <div className="flex items-center justify-center gap-2 py-2 w-full bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
            <BellRing size={14} className="text-amber-600 animate-bounce" />
            <span className="text-[11px] font-bold text-amber-700">
              Tiếp: {logic.booking.nextServiceName || 'Đơn mới'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}
            </span>
          </div>
        </div>
      ) : null}

      {/* 2x2 Action Grid + Emergency Wide - ONLY SHOW WHEN RUNNING OR PAUSED */}
      {(isTimerRunning || isPaused) && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="flex flex-col gap-3 pb-safe"
        >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ActionGridButton
                  onClick={handleEarlyExit}
                  icon={<LogOut size={20} />} 
                  label="KHÁCH VỀ SỚM" 
                  color="text-rose-600 border-rose-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('WATER')} 
                  icon={<Coffee size={20} />} 
                  label="GỌI NƯỚC" 
                  color="text-amber-600 border-amber-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('BUY_MORE')} 
                  icon={<PlusSquare size={20} />} 
                  label="MUA THÊM DV" 
                  color="text-emerald-600 border-emerald-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('SUPPORT')} 
                  icon={<HelpCircle size={20} />} 
                  label="HỖ TRỢ" 
                  color="text-blue-600 border-blue-50" 
                />
            </div>
            
            <div className="mt-2 pt-2 border-t border-slate-100">
              <button
                onClick={async () => {
                  // Dừng đơn TRƯỚC rồi mới báo động, và KHÔNG hỏi lại: đang sự cố mà
                  // bắt xác nhận thì KTV bỏ qua, báo động gửi đi mà đồng hồ vẫn chạy
                  // tính tiền. Đơn đã dừng sẵn thì bỏ qua im lặng, chỉ gửi báo động.
                  await logic.handlePause({ skipConfirm: true, silentIfPaused: true });
                  await handleInteraction('EMERGENCY');
                }}
                className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-rose-200 active:scale-95 transition-all"
              >
                <ShieldAlert size={18} />
                BÁO ĐỘNG KHẨN CẤP
              </button>
            </div>
        </motion.div>
      )}

      {/* WebRTC Camera Overlay */}

      <ShiftExtensionModal
        isOpen={showExtensionModal}
        onClose={() => setShowExtensionModal(false)}
        currentEndTime={logic.shiftExtension?.currentEndTime ?? null}
        onConfirm={logic.shiftExtension?.extend ?? (async () => false)}
        isSubmitting={logic.shiftExtension?.isSubmitting ?? false}
      />

    </div>
  );
}
