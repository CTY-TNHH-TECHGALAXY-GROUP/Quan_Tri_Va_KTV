'use client';

import React, { useState, Suspense } from 'react';
import { API } from '@/lib/api-endpoints';
import { roomLabel } from '@/lib/room-label';
import { ActionGridButton, ChecklistItem, RatingCard, CollapsibleRequirements } from '../_shared/components';
import { AlertCircle, AlertTriangle, BellRing, BookOpen, Camera, CheckCircle, Clock, Coffee, HelpCircle, Info, LogOut, Play, PlusSquare, RefreshCw, ShieldAlert } from 'lucide-react';
import { THEME, ANIMATION, DEFAULT_BOOKING_URL, formatMultiServiceNames, WebBookingQR, ServiceTypeLabel } from '../_shared/ui';
import { apiClient } from '@/lib/apiClient';
import { compressImageWithWatermark } from '@/lib/camera.logic';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '@/components/ui/Toast';

export function WorkingTimeline({ segments, activeIndex, actualStartTime, shouldMerge, totalAssignedMins }: { segments: any[], activeIndex?: number, actualStartTime?: string | null, shouldMerge?: boolean, totalAssignedMins?: number }) {
  if (!segments || segments.length === 0) return null;

  let displaySegments = segments;
  if (shouldMerge && segments.length > 0) {
    const totalDuration = totalAssignedMins || segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
    displaySegments = [{
      ...segments[0],
      id: 'merged-' + segments[0].id,
      duration: totalDuration
    }];
  }

  // Helper để tính giờ tịnh tiến
  const getShiftedTime = (offsetMins: number) => {
    if (!actualStartTime) return null;
    let tStart = actualStartTime;
    // Xử lý chuỗi HH:mm hoặc HH:mm:ss
    if (typeof tStart === 'string' && /^\d{1,2}:\d{2}/.test(tStart)) {
        const [h, m] = tStart.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m + offsetMins, 0, 0);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    if (typeof tStart === 'string' && !tStart.includes('Z') && !tStart.includes('+')) {
        tStart = tStart.replace(' ', 'T') + 'Z';
    }
    const date = new Date(new Date(tStart).getTime() + (offsetMins * 60 * 1000));
    if (isNaN(date.getTime())) return actualStartTime; // Fallback
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  let cumulativeMins = 0;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between">
        <span>Lộ trình thực hiện</span>
        {activeIndex !== undefined && <span className="text-emerald-600">Chặng {activeIndex + 1}</span>}
      </h3>
      <div className="space-y-2">
        {displaySegments.map((seg, idx) => {
          const isActive = shouldMerge ? activeIndex !== undefined : idx === activeIndex;
          const isPast = shouldMerge ? false : (activeIndex !== undefined && idx < activeIndex);
          
          const displayStartTime = actualStartTime ? getShiftedTime(cumulativeMins) : seg.startTime;
          cumulativeMins += seg.duration;
          const displayEndTime = actualStartTime ? getShiftedTime(cumulativeMins) : seg.endTime;

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
                  {isActive && <span className="ml-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-md animate-pulse">ĐANG LÀM</span>}
                </p>
                <p className={`text-[10px] font-bold uppercase tracking-tighter ${isActive ? 'text-emerald-600/70' : 'text-slate-400'}`}>
                  Giường {seg.bedId?.split('-').pop()} • {seg.duration} phút {shouldMerge && '(Gộp)'}
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
          const watermarkText = `Room ${booking?.assignedRoomId || booking?.roomName || ''}`;
          const compressed = await compressImageWithWatermark(file, {
              minBrightness,
              watermarkText
          });
          logic.setStartPhotoBase64(compressed);
      } catch (err: any) {
          if (err?.message === 'TOO_DARK') {
              addToast('⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi có đủ ánh sáng.', 'error');
          } else {
              const reader = new FileReader();
              reader.onload = (ev) => {
                  const result = ev.target?.result as string;
                  if (result) logic.setStartPhotoBase64(result);
              };
              reader.readAsDataURL(file);
          }
      }
      if (e.target) e.target.value = '';
  };

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
  const allTimerServiceNames = allTimerItemsRaw.map((i: any) => i.service_name).filter(Boolean);
  
  // Segments: dùng allTimerItemsRaw để tính tổng duration chính xác
  const allTimerKtvSegments = allTimerItemsRaw.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = JSON.parse(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = i.segments;
    }
    return segs
      .filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase())
      .map((s: any) => {
        let customName = undefined;
        try {
            const opts = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
            customName = opts?.serviceNamesForKtvs?.[s.ktvId || logic.ktvId];
        } catch(e) {}
        return { ...s, _itemId: i.id, _serviceName: customName || i.service_name };
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
  const uniqueRoomIds = new Set(ktvSegments.map((s: any) => s.roomId || 'unknown'));
  const hasFinishedSegment = ktvSegments.some((s: any) => s.actualEndTime);
  const allFinished = ktvSegments.length > 0 && ktvSegments.every((s: any) => s.actualEndTime);
  const isFinishedMerge = allFinished && ktvSegments[0].actualEndTime === ktvSegments[ktvSegments.length - 1].actualEndTime;
  const shouldMerge = hasTimerMergedChildren || (ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length && uniqueRoomIds.size === 1 && !hasFinishedSegment);

  const totalAssignedMins = allTimerKtvSegments.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;
  const nextSeg = ktvSegments.length > (activeSegmentIndex + 1) && !shouldMerge ? ktvSegments[activeSegmentIndex + 1] : null;

  // 🕒 CHỈ HIỂN THỊ THỜI GIAN CỦA CHẶNG HIỆN TẠI (trừ phi được gộp)
  const displayDuration = shouldMerge ? totalAssignedMins : (currentSeg ? (Number(currentSeg.duration) || 60) : ((item.duration != null && item.duration !== '' ? Number(item.duration) : 60)));

  const parsedSetup = Number(logic.settings?.ktv_setup_duration_minutes);
  const setupMins = !isNaN(parsedSetup) ? parsedSetup : 0;
  
  const totalDuration = isPrepping 
    ? setupMins * 60 
    : displayDuration * 60;
  
  // 🔄 Reverse progress: Start full (100) and move to 0 as time runs out
  const progress = totalDuration > 0 ? (currentSecs / totalDuration) * 100 : 0;

  // Xử lý hiển thị giờ bắt đầu / kết thúc
  const startTimeRaw = currentSeg?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null;
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
      <div className="flex justify-between items-start mb-6 px-2">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-black text-emerald-700 leading-tight tracking-tight flex items-center gap-2 flex-wrap break-words">
            {item.guest_label && (
               <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-lg flex items-center gap-1 shrink-0 border border-emerald-200">
                 👨 {item.guest_label}
               </span>
            )}
            <span className="min-w-0 break-words">{allTimerServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : item.service_name}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-3 gap-y-1">
            <div className="flex items-center gap-1.5 text-slate-800 font-black shrink-0">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest">
                {ktvSegments.length > 1 && !shouldMerge ? `Chặng ${activeSegmentIndex + 1}` : 'Phòng'}
              </span>
              <span className="text-lg">
                {roomLabel(currentSeg?.roomId || booking?.assignedRoomId || item.roomName || booking?.roomName)}
                {(currentSeg?.bedId || booking?.assignedBedId) && ` (G: ${(currentSeg?.bedId || booking.assignedBedId).split('-').pop()})`}
              </span>
            </div>
            <div className="w-px h-3 bg-slate-200 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-slate-400 font-bold text-xs shrink-0">
              <Clock size={14} />
              <span>{displayDuration} phút</span>
            </div>
            <div className="shrink-0">
              <ServiceTypeLabel serviceId={item.serviceId} />
            </div>
          </div>
          {/* CoWorkers display in Timer - chỉ khi cùng 1 dịch vụ */}
          {(() => {
            const timerAssignedItem = booking?.assignedItemId
              ? booking.BookingItems?.find((bi: any) => bi.id === booking.assignedItemId)
              : null;
            const timerCoWorkers = (timerAssignedItem?.technicianCodes || []).filter((code: string) => code !== logic.ktvId);
            return timerCoWorkers.length > 0 ? (
              <p className="mt-1 text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">Cùng làm với {timerCoWorkers.join(', ')}</p>
            ) : null;
          })()}
        </div>
        <div className="flex gap-2 shrink-0">
          {isTimerRunning && (
            <button 
              onClick={() => logic.forceRefresh?.()}
              className="flex flex-col items-center gap-1 text-slate-400 active:scale-90 transition-all shrink-0"
            >
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200 shadow-sm">
                <RefreshCw size={22} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-tighter">Tải lại</span>
            </button>
          )}
          <button 
            onClick={() => logic.setShowProcedure(true)}
            className="flex flex-col items-center gap-1 text-emerald-600 active:scale-90 transition-all shrink-0"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-sm">
              <BookOpen size={22} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-tighter">Quy trình</span>
          </button>
        </div>
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
              "{item.handover_comment}"
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
            actualStartTime={ktvSegments[0]?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null}
            shouldMerge={shouldMerge}
            totalAssignedMins={totalAssignedMins}
          />
        </div>
      )}



      {/* Primary Action Button */}
      <div className="px-6 mb-10">
        {(!isTimerRunning && !isPaused) || isPrepping ? (
          <div className="space-y-4">
            {/* Selfie Photo Preview (Sequential Flow) */}
            {logic.startPhotoBase64 && (
              <div className="bg-slate-50 border border-slate-100 rounded-3xl p-4 flex items-center justify-between gap-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-emerald-500 shadow-md">
                    <img src={logic.startPhotoBase64} className="w-full h-full object-cover" alt="Selfie preview" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-800">Đã lưu ảnh chụp!</p>
                    <p className="text-[10px] text-slate-400 font-bold">Bấm Bắt đầu để kích hoạt ca</p>
                  </div>
                </div>
                <button 
                  onClick={() => logic.setStartPhotoBase64(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-slate-200"
                >
                  Chụp lại 🔄
                </button>
              </div>
            )}

            {/* Action buttons based on photo status */}
            {logic.startPhotoBase64 ? (
              <button
                onClick={handleStartTimer}
                disabled={logic.isLoading}
                className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-lg shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-3 transition-all disabled:opacity-40"
              >
                <Play fill="white" size={24} />
                {logic.isLoading ? 'ĐANG BẮT ĐẦU...' : 'BẮT ĐẦU PHỤC VỤ'}
              </button>
            ) : (
              <div className="flex gap-3">
                <label className="relative flex-[2] h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-xs shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-45 disabled:active:scale-100">
                  <Camera size={18} />
                  {logic.canStart ? 'CHỤP ẢNH ĐỂ BẮT ĐẦU' : 'CHƯA ĐẾN GIỜ'}
                  <input type="file" accept="image/*" capture="environment" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
                </label>
                <label className="relative flex-[0.8] h-16 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-[32px] flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.98] disabled:opacity-40">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Tải ảnh</span>
                  <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
                </label>
              </div>
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
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="flex items-center justify-center gap-2 py-4 bg-emerald-50 border border-emerald-200 rounded-2xl w-full">
              <Clock size={16} className="text-emerald-600 animate-pulse" />
              <span className="text-sm font-bold text-emerald-700">Hệ thống tự động hoàn tất khi hết giờ</span>
            </div>
            
            {logic.booking?.nextBookingId && (
              <div className="flex items-center justify-center gap-2 py-2 w-full mt-2 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                <BellRing size={14} className="text-amber-600 animate-bounce" />
                <span className="text-[11px] font-bold text-amber-700">
                  Tiếp: {logic.booking.nextServiceName || 'Đơn mới'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Special Requirements Section */}
      <CollapsibleRequirements booking={booking} />

      {/* 2x2 Action Grid + Emergency Wide - ONLY SHOW WHEN RUNNING OR PAUSED */}
      {(isTimerRunning || isPaused) && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="flex flex-col gap-3 pb-safe"
        >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ActionGridButton 
                  onClick={() => { logic.handlePause(); handleEarlyExit(); }} 
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
        </motion.div>
      )}

      {/* WebRTC Camera Overlay */}

    </div>
  );
}
