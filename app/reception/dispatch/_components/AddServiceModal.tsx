'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { isUtilityService } from '@/lib/booking.logic';

/** Tên dịch vụ có thể là chuỗi hoặc object đa ngôn ngữ tuỳ đời dữ liệu. */
function serviceName(svc: any): string {
  const vn = svc?.nameVN;
  if (vn && typeof vn === 'object') return vn.vn || vn.en || String(vn);
  return vn || svc?.nameEN || `Dịch vụ ${svc?.code || svc?.id}`;
}

/**
 * Chọn dịch vụ để THÊM vào đơn, hoặc để ĐỔI dịch vụ đang có.
 *
 * Hai việc dùng chung một giao diện, phân biệt bằng `editing`: có giá trị là
 * đang đổi, `null` là đang thêm. Khi đổi thì không hiện ô chọn khách vì dịch vụ
 * cũ đã gắn sẵn với một khách.
 */
export function AddServiceModal({
  open,
  editing,
  services,
  order,
  currentGuestId,
  selectedGuestId,
  onSelectGuest,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Đang đổi dịch vụ nào; `null` nghĩa là đang thêm mới. */
  editing: { oldSvcName?: string } | null;
  services: any[];
  order: any;
  /** Khách của đơn con đang chọn — dùng làm mặc định cho ô chọn khách. */
  currentGuestId?: string;
  selectedGuestId: string;
  onSelectGuest: (guestId: string) => void;
  onPick: (svcId: string, name: string, durationMins: number) => void;
  onClose: () => void;
}) {
  // Ô tìm kiếm là state nội bộ — page không cần biết quầy đang gõ gì.
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = services.filter((svc: any) => {
    if (!query.trim()) return true;
    return serviceName(svc).toLowerCase().includes(query.toLowerCase());
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative bg-white rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="font-black text-gray-900 text-lg uppercase tracking-tight">
                  {editing ? 'Đổi Dịch Vụ' : 'Thêm Dịch Vụ'}
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                  {editing ? `Đang đổi cho: ${editing.oldSvcName}` : 'Chọn từ danh mục phổ biến'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-3 hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors"
              >
                <Plus className="rotate-45" size={24} />
              </button>
            </div>

            {/* Chọn khách — chỉ khi THÊM mới, vì lúc đổi thì khách đã cố định. */}
            {!editing && order && (
              <div className="px-6 pt-4 pb-0">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                  Thêm cho khách:
                </label>
                <select
                  value={selectedGuestId || currentGuestId || ''}
                  onChange={(e) => onSelectGuest(e.target.value)}
                  className="w-full bg-indigo-50/50 px-3 py-2.5 rounded-xl border-2 border-indigo-100 text-sm font-bold text-indigo-900 outline-none focus:border-indigo-300"
                >
                  {order.guests?.map((g: any, idx: number) => (
                    <option key={g.id} value={g.id}>
                      {g.guestLabel || `Khách ${idx + 1}`} {currentGuestId === g.id ? '(Khách hiện tại)' : ''}
                    </option>
                  ))}
                  {(!order.guests || order.guests.length === 0) && (
                    <option value={currentGuestId || 'default'}>Khách hiện tại</option>
                  )}
                  <option value="NEW">+ Thêm khách mới</option>
                </select>
              </div>
            )}

            <div className="px-6 pt-4 pb-2">
              <input
                type="text"
                placeholder="Tìm dịch vụ..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-indigo-400 transition-colors placeholder:text-gray-300"
              />
            </div>

            <div className="p-6 pt-2 grid grid-cols-1 gap-3 max-h-[60vh] overflow-y-auto no-scrollbar pb-10 sm:pb-6">
              {filtered.map((svc: any) => {
                const name = serviceName(svc);
                const dur = svc.duration ?? 60;
                const price = svc.priceVND || 0;
                const isUtilitySvc = isUtilityService(svc);
                return (
                  <button
                    key={svc.id}
                    onClick={() => onPick(svc.id, name, dur)}
                    className={`group p-5 text-left border-2 rounded-2xl transition-all flex items-center justify-between active:scale-[0.98] ${isUtilitySvc ? 'border-amber-200 hover:border-amber-400 hover:bg-amber-50/30' : 'border-gray-100 hover:border-indigo-500 hover:bg-indigo-50/30'}`}
                  >
                    <div>
                      <p className={`font-black transition-colors ${isUtilitySvc ? 'text-amber-700 group-hover:text-amber-800' : 'text-gray-900 group-hover:text-indigo-600'}`}>{name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {isUtilitySvc
                          ? <span className="text-[10px] text-amber-600 font-black bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200 uppercase tracking-wider">Tiện ích</span>
                          : <span className="text-xs text-gray-400 font-bold uppercase tracking-widest">{dur} PHÚT</span>
                        }
                        {price > 0 && <span className="text-xs text-emerald-600 font-black">{price.toLocaleString()}đ</span>}
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                      <Plus size={20} strokeWidth={3} />
                    </div>
                  </button>
                );
              })}
              {services.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-8 font-medium">Đang tải danh sách dịch vụ...</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
