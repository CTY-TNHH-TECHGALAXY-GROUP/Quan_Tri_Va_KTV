'use client';

import React, { useState, Suspense } from 'react';
import { API } from '@/lib/api-endpoints';
import { AlertTriangle, Camera, Loader2, Sparkles, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { compressImageWithWatermark } from '@/lib/camera.logic';
import { useToast } from '@/components/ui/Toast';

export function ScreenHandover({ logic }: { logic: any }) {
  const { addToast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<any>(null);
  const { handoverPhotosBase64, setHandoverPhotosBase64, isHandoverComplete, handleFinishHandover, booking, minBrightness = 40 } = logic;
  const { dynamicChecklist = [], isFetchingChecklist, handleSkipHandover, isSkippingHandover, isRepayingDebt, skipBlockedMsg, setSkipBlockedMsg, skipQuota } = logic;

  // Hết lượt bỏ qua thì KHÓA NÚT luôn, đừng để KTV bấm rồi mới bị từ chối.
  const noSkipLeft = !!skipQuota && skipQuota.remaining <= 0;

  // Đang TRẢ NỢ mà chưa chụp đủ ảnh: không cho "Bỏ qua" (nợ sẽ không bao giờ
  // trả xong), nhưng cũng KHÔNG nhốt KTV lại. Trước đây nút xám ngắt "Chưa chụp
  // đủ ảnh" là ngõ cụt — có đơn mới đang chờ mà không có đường nào ra ngoài
  // ngoài việc phải chụp cho xong ngay lúc đó. Nay nút đổi thành TRỞ LẠI: phòng
  // vẫn còn nợ nguyên đó, quay lại nộp sau.
  const isDebtNeedsPhotos = isRepayingDebt && !isHandoverComplete;
  const skipLocked = noSkipLeft && !isRepayingDebt && !isHandoverComplete;
  
  // V5: Use dynamic checklist from API, fallback to old checklist from booking
  let checklist: string[] = dynamicChecklist.length > 0
    ? dynamicChecklist.map((c: any) => c.label)
    : (booking?.handoverChecklist || []);

  // Nếu cả 2 đều rỗng (chưa cài đặt), fallback về 1 mục chung để giữ giao diện lưới
  if (checklist.length === 0) {
      checklist = ['Ảnh tổng quan phòng'];
  }

  // V5: Show skip button only if there's a next order
  const hasNextOrder = !!booking?.nextBookingId;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, itemKey?: string) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      logic.setIsLoading?.(true);
      
      const newPhotos: string[] = [];
      const watermarkText = `Room ${booking?.assignedRoomId || booking?.roomName || ''} - Handover`;

      for (const file of files) {
          try {
              const compressed = await compressImageWithWatermark(file, { minBrightness: 0, watermarkText });
              newPhotos.push(compressed);
          } catch (err: any) {
              if (err?.message === 'TOO_DARK') {
                  addToast(`⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi đủ ánh sáng.`, 'error');
              } else {
                  const base64 = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = (ev) => resolve(ev.target?.result as string);
                      reader.readAsDataURL(file);
                  });
                  if (base64) newPhotos.push(base64);
              }
          }
      }
      
      if (newPhotos.length > 0) {
          setHandoverPhotosBase64((prev: Record<string, string>) => {
              const updated = { ...prev };
              let timestamp = Date.now();
              newPhotos.forEach((photo) => {
                  updated[timestamp.toString()] = photo;
                  timestamp++;
              });
              return updated;
          });
      }
      logic.setIsLoading?.(false);
      if (e.target) e.target.value = '';
  };

  return (
    <div className="p-6 md:p-10 pt-12 md:pt-16 space-y-8 md:max-w-2xl md:mx-auto w-full">
      <div className="text-center space-y-2">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-blue-600" size={40} />
        </div>
        <h2 className="text-2xl font-black text-slate-800">Bàn giao phòng</h2>
        <p className="text-slate-500 font-medium">Chụp ảnh từng mục bàn giao theo danh sách.</p>
      </div>

      <div className="space-y-4">
          <div className="space-y-3">
             <div className="flex items-center justify-between px-1">
                 <span className="text-sm font-bold text-slate-700">Yêu cầu bàn giao</span>
                 <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                     {isFetchingChecklist ? <Loader2 size={12} className="animate-spin inline-block" /> : `${Object.keys(handoverPhotosBase64).length}/${checklist.length}`}
                 </span>
             </div>
             
             {/* Danh sách yêu cầu */}
             <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-100">
                 {isFetchingChecklist ? (
                     <div className="space-y-2 animate-pulse">
                         <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                         <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                     </div>
                 ) : (
                     <ul className="space-y-2">
                         {checklist.map((item, idx) => (
                             <li key={idx} className="flex flex-col gap-0.5">
                                 <div className="flex items-start gap-2">
                                     <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                                     <span className="text-xs font-semibold text-slate-700">{item}</span>
                                 </div>
                                 {dynamicChecklist[idx]?.source && (
                                     <span className="text-[10px] text-slate-400 ml-3.5">
                                         Từ {dynamicChecklist[idx]?.source === 'room' ? 'Phòng' : 'Dịch vụ'}
                                     </span>
                                 )}
                             </li>
                         ))}
                     </ul>
                 )}
             </div>

             {/* Khu vực Upload */}
             <div className="pt-2">
                 <label className="w-full flex items-center justify-center gap-2 py-4 bg-blue-50 text-blue-600 border-2 border-dashed border-blue-200 rounded-2xl cursor-pointer active:scale-95 transition-all hover:bg-blue-100/50">
                     <Camera size={20} />
                     <span className="font-bold text-sm">Chụp / Tải ảnh lên</span>
                     <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFileUpload(e)} disabled={logic.isLoading} />
                 </label>
             </div>

             {/* Grid Ảnh Đã Up */}
             {Object.keys(handoverPhotosBase64).length > 0 && (
                 <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
                     {Object.entries(handoverPhotosBase64).map(([key, photo]) => (
                         <div key={key} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm group">
                             <img src={photo as string} className="absolute inset-0 w-full h-full object-cover" alt="Uploaded" />
                             <button 
                                 onClick={() => {
                                     const newPhotos = { ...handoverPhotosBase64 };
                                     delete newPhotos[key];
                                     setHandoverPhotosBase64(newPhotos);
                                 }}
                                 className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-rose-500 transition-colors"
                             >
                                 <X size={14} />
                             </button>
                         </div>
                     ))}
                 </div>
             )}
          </div>
      </div>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* Đã nợ quá số đơn cho phép → chặn hẳn, không phải nhắc nhẹ. Dùng hộp thoại
          chứ không phải toast: toast trôi mất, KTV bấm lại rồi lại tưởng app đơ. */}
      {skipBlockedMsg && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSkipBlockedMsg(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-[28px] shadow-2xl overflow-hidden">
            <div className="bg-rose-600 p-5 text-white flex items-center gap-3">
              <AlertTriangle size={22} />
              <h3 className="font-black text-base uppercase tracking-tight">Không bỏ qua được nữa</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm font-bold text-slate-800 leading-relaxed">{skipBlockedMsg}</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Hãy chụp đủ ảnh bàn giao cho phòng này, hoặc vào mục <b>Nợ bàn giao</b> trên
                trang chủ để trả nợ các phòng cũ trước.
              </p>
            </div>
            <div className="p-4 pt-0">
              <button
                onClick={() => setSkipBlockedMsg(null)}
                className="w-full h-12 rounded-2xl font-black bg-slate-900 text-white active:scale-[0.98] transition-transform"
              >Đã hiểu</button>
            </div>
          </div>
        </div>
      )}

      {/* Room Issue Report Button */}
      <button
        onClick={() => logic.setShowRoomIssueModal(true)}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-rose-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-100/50"
      >
        <AlertTriangle size={16} />
        Báo sự cố phòng
      </button>

      {/* Nút tích hợp V5: Xử lý dựa trên hasNextOrder và isHandoverComplete */}
      {/* Đang trả nợ mà vẫn thiếu ảnh thì không cho bỏ qua: món nợ này sinh ra
          đúng vì lần trước bỏ qua, cho bỏ qua tiếp là nợ không bao giờ trả xong.
          Lối ra không cần giải thích bằng chữ — nút ngay bên dưới đã ghi
          "← Trở lại". */}
      {isRepayingDebt && !isHandoverComplete && (
        <p className="text-xs text-center font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          Phòng đang <b>NỢ bàn giao</b> — chụp đủ ảnh mới nộp được.
        </p>
      )}

      {/* Chỉ báo khi ĐÃ HẾT lượt — lúc đó là chặn thật, phải nói trước khi bấm.
          Còn lượt thì không nhắc: dòng "còn 1/2 lượt" hiện thường trực chỉ làm
          nhiễu màn hình, mà số lượt còn lại vẫn được nói đúng lúc cần — trong
          hộp thoại xác nhận ngay trước khi KTV bấm Bỏ qua. */}
      {!isRepayingDebt && !isHandoverComplete && noSkipLeft && skipQuota && (
        <p className="text-xs text-center font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          Bạn đã dùng hết {skipQuota.max}/{skipQuota.max} lượt bỏ qua và đang nợ {skipQuota.used} phòng.
          <br/>Không bỏ qua tiếp được — phải chụp đủ ảnh, hoặc trả nợ phòng cũ trước.
        </p>
      )}

      <button
        disabled={logic.isLoading || isSkippingHandover || skipLocked}
        onClick={() => {
            if (skipLocked) return;
            // Trả nợ mà thiếu ảnh → chỉ rời màn hình, KHÔNG gọi API nào: không
            // nộp, không ghi thêm nợ, không tiêu lượt bỏ qua. Đúng nghĩa "để đó".
            if (isDebtNeedsPhotos) { logic.goToDashboard?.(); return; }
            if (!isHandoverComplete) {
                if (hasNextOrder) {
                    // Nếu có đơn mới và chưa chụp ảnh -> Cho nợ ảnh và qua đơn luôn
                    handleSkipHandover();
                } else {
                    // Nếu không có đơn mới mà chưa chụp ảnh -> Hỏi cảnh báo phạt
                    setConfirmDialog({
                        open: true,
                        title: 'Thiếu Ảnh Bàn Giao',
                        message: skipQuota
                            ? `Bạn chưa chụp đủ ảnh. Bỏ qua sẽ bị ghi NỢ BÀN GIAO và bạn chỉ còn ${Math.max(0, skipQuota.remaining - 1)}/${skipQuota.max} lượt. Còn nợ thì chưa tan ca được.`
                            : 'Bạn chưa chụp đủ ảnh bàn giao, nếu bỏ qua sẽ bị ghi NỢ BÀN GIAO. Còn nợ thì chưa tan ca được.',
                        onConfirm: () => {
                            setConfirmDialog(null);
                            // PHẢI đi qua handleSkipHandover để ghi nợ, giống hệt nhánh
                            // "có đơn kế tiếp" ngay trên.
                            //
                            // Trước đây nhánh này gọi thẳng handleFinishHandover: API
                            // /handover/skip không bao giờ được gọi nên handover_status
                            // KHÔNG chuyển sang SKIPPED — đơn nằm lại ở 'PENDING', y hệt
                            // đơn chưa từng bàn giao. Không có nợ nào được ghi, ô "Nợ bàn
                            // giao" trống, nút Tan ca vẫn mở, và lời hứa "sẽ bị phạt"
                            // trong chính hộp thoại này chưa từng thành sự thật.
                            //
                            // handleSkipHandover tự gọi handleFinishHandover khi ghi nợ
                            // xong, và chặn lại nếu KTV đã quá số lần nợ cho phép.
                            handleSkipHandover();
                        },
                        onCancel: () => setConfirmDialog(null),
                        variant: 'danger'
                    });
                }
            } else {
                handleFinishHandover();
            }
        }}
        className={`w-full py-5 rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl transition-all
        ${skipLocked
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
            : isDebtNeedsPhotos
            ? 'bg-slate-700 text-white shadow-slate-200'
            : isHandoverComplete
            ? 'bg-blue-600 text-white shadow-blue-200'
            : (hasNextOrder ? 'bg-amber-500 text-white shadow-amber-200' : 'bg-rose-500 text-white shadow-rose-200')}`}
      >
        {logic.isLoading || isSkippingHandover 
          ? 'Đang xử lý...' 
          : skipLocked
              ? 'Đã hết lượt bỏ qua'
          : isDebtNeedsPhotos
              ? '← Trở lại'
          : (isHandoverComplete
              ? (isRepayingDebt ? 'Nộp ảnh & Trả nợ' : (hasNextOrder ? 'Xong & Nhận đơn mới' : 'Xong & Sẵn sàng đón khách'))
              : (hasNextOrder ? '⏭ Bỏ qua — Nhận đơn mới' : 'Bỏ qua')
            )
        }
      </button>

    </div>
  );
}
