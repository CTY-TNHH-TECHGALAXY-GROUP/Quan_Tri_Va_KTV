'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Plus, Sparkles } from 'lucide-react';

export interface SplitDurationConfig {
  duration: number;
  ktv1Dur: number;
  ktv2Dur: number;
  name1?: string;
  name2?: string;
  defaultName?: string;
  isSaving?: boolean;
  [k: string]: any;
}

/**
 * Chia thời lượng một dịch vụ cho hai KTV.
 *
 * Hai chế độ, phân biệt bằng `ktv1Dur` so với `duration`:
 *  - BẰNG nhau  → hai KTV làm SONG SONG, chung một khung giờ.
 *  - KHÁC nhau  → làm NỐI TIẾP, hệ thống tách thành 2 dòng để tính giờ riêng.
 *
 * State vẫn do page giữ (hàm lưu đọc trực tiếp `splitConfig`), component chỉ
 * báo thay đổi qua `onChange`.
 */
export function SplitDurationModal({
  config,
  onChange,
  onConfirm,
  onCancel,
}: {
  config: SplitDurationConfig | null;
  onChange: (patch: Partial<SplitDurationConfig>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
      <AnimatePresence>
        {config && (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6"
            >
              <h3 className="text-xl font-black text-gray-900 mb-2">Phân bổ thời gian KTV</h3>
              <p className="text-sm text-gray-500 mb-6">
                Thời lượng gốc: <span className="font-bold text-gray-900">{config.duration} phút</span>
              </p>

              <div className="space-y-4 mb-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">
                    KTV Hiện Tại (Phút)
                  </label>
                  <input
                    type="number"
                    value={config.ktv1Dur}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0 && val <= config.duration) {
                        onChange({
                          ktv1Dur: val,
                          ktv2Dur: config.duration - val
                        });
                      }
                    }}
                    className="w-full text-center font-black text-2xl text-indigo-600 bg-white border border-gray-200 rounded-xl py-2 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                  />
                  {config.ktv1Dur !== config.duration && (
                    <div className="mt-3">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">
                        Tên Dịch Vụ
                      </label>
                      <input
                        type="text"
                        value={config.name1 || ''}
                        onChange={(e) => onChange({  name1: e.target.value })}
                        className="w-full text-center font-bold text-sm text-gray-700 bg-white border border-gray-200 rounded-xl py-1.5 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                        placeholder={config.defaultName}
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-center text-gray-300">
                  <Plus size={24} />
                </div>

                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-2">
                    KTV Thêm Vào (Phút)
                  </label>
                  <input
                    type="number"
                    value={config.ktv2Dur}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0 && val <= config.duration) {
                        onChange({
                          ktv2Dur: val,
                          ktv1Dur: config.duration - val
                        });
                      }
                    }}
                    className="w-full text-center font-black text-2xl text-indigo-700 bg-white border border-indigo-200 rounded-xl py-2 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                  />
                  {config.ktv1Dur !== config.duration && (
                    <div className="mt-3">
                      <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">
                        Tên Dịch Vụ
                      </label>
                      <input
                        type="text"
                        value={config.name2 || ''}
                        onChange={(e) => onChange({  name2: e.target.value })}
                        className="w-full text-center font-bold text-sm text-indigo-700 bg-white border border-indigo-200 rounded-xl py-1.5 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                        placeholder={config.defaultName}
                      />
                    </div>
                  )}
                </div>
              </div>
              
              {config.ktv1Dur !== config.duration && (
                <div className="mb-6 p-3 bg-amber-50 rounded-xl border border-amber-100 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 font-medium">
                    <span className="font-bold block mb-1">Làm Nối Tiếp</span>
                    Hệ thống sẽ <strong className="font-black">tách dịch vụ thành 2 dòng riêng biệt</strong> trên màn hình Lễ tân & KTV để tính giờ độc lập.
                  </p>
                </div>
              )}
              
              {config.ktv1Dur === config.duration && config.ktv2Dur === config.duration && (
                <div className="mb-6 p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-start gap-2">
                  <Sparkles size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700 font-medium">
                    <span className="font-bold block mb-1">Làm Chung (Song song)</span>
                    Hai KTV sẽ cùng dùng chung 1 khung giờ. 1 người bấm sẽ cập nhật cho người kia.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancel}
                  disabled={config.isSaving}
                  className="px-4 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={onConfirm}
                  disabled={config.isSaving || (config.ktv1Dur + config.ktv2Dur !== config.duration && config.ktv1Dur !== config.duration)}
                  className="px-6 py-3 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-50"
                >
                  {config.isSaving ? 'ĐANG LƯU...' : 'LƯU & TIẾP TỤC'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
  );
}
