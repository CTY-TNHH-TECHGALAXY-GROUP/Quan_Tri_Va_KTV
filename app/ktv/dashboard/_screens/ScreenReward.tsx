'use client';

import React, { useState, Suspense } from 'react';
import { BellRing, Camera, CheckCircle2, Gift, Loader2, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '@/components/ui/Toast';

export function ScreenReward({ logic }: { logic: any }) {
  const { addToast } = useToast();
  const { commission, goToDashboard, booking, ktvId, workType, rewardHideMoney } = logic;
  const [rating, setRating] = React.useState(5);
  const [note, setNote] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [images, setImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);

  // ⚠️ Tải qua MÁY CHỦ, không tải thẳng từ trình duyệt.
  // Bản cũ gọi `supabase.storage…upload` bằng client anon trần (không đọc cookie
  // đăng nhập), trong khi kho `task-photos` chỉ cho `authenticated` tải lên — nên
  // mọi lần đều bị RLS chặn và chưa từng có ảnh nào vào được. Xem
  // /api/ktv/review-reception/upload.
  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    e.target.value = '';   // cho chọn lại đúng file đó nếu lần trước lỗi
    if (!ktvId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('techCode', ktvId);
      const res = await fetch('/api/ktv/review-reception/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data?.success || !data?.url) throw new Error(data?.error || 'Không nhận được đường dẫn ảnh');
      setImages(prev => [...prev, data.url]);
    } catch (err: any) {
      console.error('Lỗi tải ảnh:', err);
      addToast(`Tải ảnh thất bại: ${err?.message || 'không rõ lỗi'}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  // One button does both: send the reception review (default 5 stars even if
  // untouched), then move on. A failed review must NEVER block the KTV from the
  // next order (Continuous Receiving) — show a toast and continue anyway.
  const submitAndContinue = async () => {
    if (isSubmitting || uploading) return;
    if (!isSubmitted) await submitReview();
    goToDashboard(booking?.nextBookingId);
  };

  const submitReview = async () => {
    if (!booking?.id || !ktvId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/ktv/review-reception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          techCode: ktvId,
          rating,
          note,
          images
        })
      });
      const data = await res.json();
      // "Already reviewed" (e.g. re-opened this screen) counts as done, no toast.
      if (data.success || res.status === 400 && /đã đánh giá/i.test(data.error || '')) {
        setIsSubmitted(true);
      } else {
        addToast(`Chưa gửi được đánh giá quầy: ${data.error || 'có lỗi xảy ra'}`, 'error');
      }
    } catch (err) {
      addToast('Chưa gửi được đánh giá quầy', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col items-center justify-start text-center space-y-4 md:space-y-6 pt-10 md:pt-16 pb-20 overflow-y-auto md:max-w-2xl md:mx-auto w-full">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1, rotate: [0, 10, -10, 0] }}
        className={`w-20 h-20 rounded-[28px] flex items-center justify-center shadow-xl shrink-0 mt-6 ${
          rewardHideMoney ? 'bg-emerald-100 shadow-emerald-100' : 'bg-amber-100 shadow-amber-100'}`}
      >
        {rewardHideMoney
          ? <CheckCircle2 className="text-emerald-600" size={40} />
          : <Gift className="text-amber-600" size={40} />}
      </motion.div>

      <div className="space-y-1">
        <h2 className="text-lg font-black text-slate-800 tracking-tight">
          {rewardHideMoney ? 'Đã trả nợ xong!' : 'Chúc mừng!'}
        </h2>
        <p className="text-xs text-slate-500 font-bold px-4">
          {rewardHideMoney
            ? 'Ảnh bàn giao đã nộp, phòng này hết nợ. Còn một bước cuối:'
            : 'Bạn vừa hoàn thành xuất sắc tua phục vụ'}
        </p>
      </div>

      {/* Vào đây từ đường TRẢ NỢ thì ẨN tiền tua: tiền của tua này đã trả từ lần
          làm xong trước rồi. Hiện lại con số đó lần hai là KTV tưởng được trả
          thêm, tới lúc mở ví không thấy đâu lại đi hỏi quầy. */}
      {rewardHideMoney ? null : workType === 'TYPE_D' ? (
          <div className="bg-white border-2 border-indigo-100 rounded-[24px] p-4 w-full shadow-lg max-w-xs sm:max-w-sm">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.1em] block mb-1">TUA ĐÃ HOÀN THÀNH</span>
              <div className="text-sm font-bold text-slate-600">
                  Vui lòng xem trong Ví để biết chi tiết thu nhập.
              </div>
          </div>
      ) : (
          <div className="bg-white border-2 border-amber-100 rounded-[24px] p-4 w-full shadow-lg max-w-xs sm:max-w-sm">
            <span className="text-[9px] font-black text-amber-600 uppercase tracking-[0.2em] block mb-1">Tua bạn nhận được</span>
            <div className="text-3xl font-black text-slate-800 tabular-nums">+{commission.toLocaleString('vi-VN')}đ</div>
          </div>
      )}

      {/* --- FORM ĐÁNH GIÁ QUẦY --- */}
      <div className="w-full max-w-xs sm:max-w-sm bg-slate-50 border border-slate-100 p-4 rounded-3xl mt-4">
        {!isSubmitted ? (
          <>
            <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest mb-3">Đánh giá Quầy Lễ Tân</h3>
            
            {/* Rating Stars */}
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} onClick={() => setRating(star)} className="focus:outline-none transition-transform active:scale-90">
                  <Star size={24} className={star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                </button>
              ))}
            </div>

            {/* Note */}
            <textarea
              placeholder="Nhập nhận xét của bạn về sự hỗ trợ của Quầy (Tuỳ chọn)..."
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full h-24 px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mb-3 bg-white resize-none"
            />

            {/* Images */}
            <div className="flex gap-2 overflow-x-auto mb-3">
              {images.map((img, idx) => (
                <img key={idx} src={img} alt="review" className="w-12 h-12 rounded-lg object-cover border border-slate-200" />
              ))}
              {images.length < 3 && (
                <label className="w-12 h-12 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors shrink-0">
                  {uploading ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <Camera size={16} className="text-slate-400" />}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUploadImage} disabled={uploading} />
                </label>
              )}
            </div>
          </>
        ) : (
          <div className="py-4 flex flex-col items-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-2">
              <CheckCircle2 size={24} className="text-emerald-600" />
            </div>
            <p className="text-xs font-bold text-slate-700">Cảm ơn bạn đã đánh giá!</p>
          </div>
        )}
      </div>
      {/* ------------------------- */}

      <div className="w-full max-w-xs sm:max-w-sm mt-4 pb-safe">
        <button
          onClick={submitAndContinue}
          disabled={isSubmitting || uploading}
          className={`w-full py-4 rounded-[20px] font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60
            ${booking?.nextBookingId
              ? 'bg-amber-600 text-white shadow-amber-200'
            : 'bg-slate-900 text-white'}`}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Đang gửi đánh giá...
          </>
        ) : booking?.nextBookingId ? (
          <>
            <BellRing size={16} className="animate-bounce" />
            Nhận đơn tiếp theo
          </>
        ) : isSubmitted ? (
          'Tiếp tục làm việc'
        ) : (
          'Gửi đánh giá & tiếp tục'
        )}
      </button>
      </div>
    </div>
  );
}
