'use client';

import React, { Dispatch, SetStateAction } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { formatToHourMinute } from '../dispatch-time.logic';

/**
 * Xem ảnh xác nhận bắt đầu ca / ảnh bàn giao phòng, có điều hướng nhiều ảnh.
 *
 * Giữ nguyên tên biến như lúc còn nằm trong page.tsx (`selectedPhoto`,
 * `photoIndex`...) để lần tách này thuần tuý di chuyển code, không đổi hành vi.
 */
export function PhotoViewerModal({
  selectedPhoto,
  setSelectedPhoto,
  photoIndex,
  setPhotoIndex,
}: {
  selectedPhoto: any;
  setSelectedPhoto: Dispatch<SetStateAction<any>>;
  photoIndex: number;
  setPhotoIndex: Dispatch<SetStateAction<number>>;
}) {
  return (
        <AnimatePresence>
          {selectedPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setSelectedPhoto(null); setPhotoIndex(0); }}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white rounded-3xl overflow-hidden max-w-md w-full shadow-2xl border border-gray-100 flex flex-col"
              >
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className={`font-black text-sm ${selectedPhoto.type === 'HANDOVER' ? 'text-emerald-600' : 'text-gray-900'}`}>
                        {selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao phòng' : 'Ảnh xác nhận khách bắt đầu ca'}
                    </h3>
                    <p className="text-xs text-gray-500 font-bold">Kỹ thuật viên: {selectedPhoto.ktvId}</p>
                  </div>
                  <button
                    onClick={() => { setSelectedPhoto(null); setPhotoIndex(0); }}
                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Image Body */}
                <div className="relative aspect-[3/4] bg-gray-50 flex items-center justify-center">
                  {selectedPhoto.urls && selectedPhoto.urls.length > 1 ? (
                    <>
                      <img
                        src={selectedPhoto.urls[photoIndex]}
                        alt={`${selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao' : 'Ảnh xác nhận khách'} - ${photoIndex + 1}`}
                        className="w-full h-full object-contain"
                      />
                    
                      {/* Navigation Buttons */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhotoIndex((prev) => (prev > 0 ? prev - 1 : selectedPhoto.urls!.length - 1));
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                      </button>
                    
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhotoIndex((prev) => (prev < selectedPhoto.urls!.length - 1 ? prev + 1 : 0));
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                      </button>
                    
                      {/* Pagination Indicators */}
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-1.5 bg-black/40 rounded-full backdrop-blur-md">
                        {selectedPhoto.urls.map((_: any, idx: number) => (
                          <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-all ${
                              idx === photoIndex ? 'bg-white scale-110' : 'bg-white/50'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <img
                      src={selectedPhoto.urls ? selectedPhoto.urls[0] : selectedPhoto.url}
                      alt={selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao' : 'Ảnh xác nhận khách'}
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>

                {/* Footer */}
                {selectedPhoto.time && (
                  <div className="p-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-bold">
                      {selectedPhoto.type === 'HANDOVER' ? 'Thời gian kết thúc:' : 'Thời gian bắt đầu:'}
                    </span>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-md border ${
                        selectedPhoto.type === 'HANDOVER' 
                        ? 'text-emerald-600 bg-emerald-50 border-emerald-100' 
                        : 'text-indigo-600 bg-indigo-50 border-indigo-100'
                    }`}>
                      {formatToHourMinute(selectedPhoto.time)}
                    </span>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
  );
}
