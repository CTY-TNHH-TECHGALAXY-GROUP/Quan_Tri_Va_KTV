'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ZoomIn, ZoomOut, RotateCcw, Check, Move, Sparkles } from 'lucide-react';

interface CardImageCropModalProps {
  isOpen: boolean;
  imageSrc: string;
  title?: string;
  staffCode?: string;
  staffName?: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm: (croppedBlob: Blob) => void;
  onUseOriginal?: () => void;
}

export function CardImageCropModal({
  isOpen,
  imageSrc,
  title = 'Căn chỉnh ảnh theo khung Card WRB Nội Bộ',
  staffCode = 'KTV',
  staffName = '',
  subtitle = 'Xem trước hiển thị thực tế',
  onClose,
  onConfirm,
  onUseOriginal,
}: CardImageCropModalProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [isProcessing, setIsProcessing] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Viewport dimensions (3:4 ratio)
  const VIEWPORT_WIDTH = 300;
  const VIEWPORT_HEIGHT = 400;
  const EXPORT_WIDTH = 900;
  const EXPORT_HEIGHT = 1200;

  // Reset state when opening with a new image
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setIsDragging(false);
      setImageLoaded(false);
      setIsProcessing(false);
    }
  }, [isOpen, imageSrc]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    setImageDimensions({
      width: target.naturalWidth || target.width || 1,
      height: target.naturalHeight || target.height || 1,
    });
    setImageLoaded(true);
  };

  // Drag handlers (Mouse & Touch)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    offsetStartRef.current = { ...offset };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    setOffset({
      x: offsetStartRef.current.x + deltaX,
      y: offsetStartRef.current.y + deltaY,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) setIsDragging(false);
  }, [isDragging]);

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      offsetStartRef.current = { ...offset };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const deltaX = e.touches[0].clientX - dragStartRef.current.x;
    const deltaY = e.touches[0].clientY - dragStartRef.current.y;
    setOffset({
      x: offsetStartRef.current.x + deltaX,
      y: offsetStartRef.current.y + deltaY,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((prev) => Math.min(3, Math.max(1, prev + delta)));
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Calculate base dimensions covering the viewport
  const baseScale = Math.max(
    VIEWPORT_WIDTH / (imageDimensions.width || 1),
    VIEWPORT_HEIGHT / (imageDimensions.height || 1)
  );
  const baseWidth = imageDimensions.width * baseScale;
  const baseHeight = imageDimensions.height * baseScale;
  const currentWidth = baseWidth * zoom;
  const currentHeight = baseHeight * zoom;

  const imgLeft = (VIEWPORT_WIDTH - currentWidth) / 2 + offset.x;
  const imgTop = (VIEWPORT_HEIGHT - currentHeight) / 2 + offset.y;

  // Render crop onto canvas and export high-res Blob
  const handleSaveCrop = async () => {
    if (!imgRef.current) return;
    setIsProcessing(true);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_WIDTH;
      canvas.height = EXPORT_HEIGHT;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        alert('Lỗi khởi tạo Canvas');
        setIsProcessing(false);
        return;
      }

      // Draw dark background matching wrb_noi_bo
      ctx.fillStyle = '#1b1b1d';
      ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

      const ratio = EXPORT_WIDTH / VIEWPORT_WIDTH; // 3x multiplier
      const drawX = imgLeft * ratio;
      const drawY = imgTop * ratio;
      const drawWidth = currentWidth * ratio;
      const drawHeight = currentHeight * ratio;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageSrc;

      await new Promise<void>((resolve, reject) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Lỗi load ảnh để cắt'));
        }
      });

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      canvas.toBlob(
        (blob) => {
          setIsProcessing(false);
          if (blob) {
            onConfirm(blob);
          } else {
            alert('Không thể tạo file ảnh đã cắt.');
          }
        },
        'image/jpeg',
        0.92
      );
    } catch (err: any) {
      console.error('Lỗi khi cắt ảnh:', err);
      if (err.name === 'SecurityError' || String(err.message).includes('Tainted') || String(err.message).includes('CORS')) {
        alert('Máy chủ nguồn của link ảnh chặn quyền xuất canvas trực tiếp (CORS). Bạn có thể tải ảnh về máy rồi bấm "+ Tải ảnh" để căn chỉnh, hoặc bấm "Giữ ảnh gốc" để lưu link.');
      } else {
        alert(err.message || 'Lỗi xử lý cắt ảnh');
      }
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-md z-[80] animate-in fade-in duration-200" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-1.5rem)] max-w-lg bg-[#18181b] border border-zinc-700/60 rounded-3xl shadow-2xl z-[90] overflow-hidden flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-200 text-white">
          {/* Header */}
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#e6c487]" />
              <div>
                <Dialog.Title className="text-sm font-bold text-white tracking-wide">
                  {title}
                </Dialog.Title>
                <p className="text-[11px] text-zinc-400">
                  Kéo thả để căn chỉnh đúng góc mặt hiển thị trên Card WRB
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Interactive Viewport Area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center bg-zinc-950/70 select-none">
            {/* Guide hint */}
            <div className="flex items-center gap-1.5 text-[11px] text-[#e6c487] mb-3 font-medium bg-[#e6c487]/10 px-3 py-1 rounded-full border border-[#e6c487]/20">
              <Move size={12} />
              <span>Dùng chuột hoặc ngón tay kéo ảnh (Drag to Pan)</span>
            </div>

            {/* Exact wrb_noi_bo Card Mockup Frame (3:4 ratio, rounded-[2rem]) */}
            <div
              ref={viewportRef}
              style={{ width: `${VIEWPORT_WIDTH}px`, height: `${VIEWPORT_HEIGHT}px` }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onWheel={handleWheel}
              className={`relative rounded-[2rem] overflow-hidden bg-[#1b1b1d] shadow-2xl border-2 border-[#e6c487]/40 ring-4 ring-black/40 touch-none transition-shadow ${
                isDragging ? 'cursor-grabbing shadow-[#e6c487]/20' : 'cursor-grab'
              }`}
            >
              {/* Image element */}
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                onLoad={handleImageLoad}
                style={{
                  position: 'absolute',
                  left: `${imgLeft}px`,
                  top: `${imgTop}px`,
                  width: `${currentWidth}px`,
                  height: `${currentHeight}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
                className="transition-transform duration-75"
              />

              {/* Rule of thirds grid lines (subtle overlay) */}
              <div className="absolute inset-0 pointer-events-none opacity-20">
                <div className="w-full h-1/3 border-b border-white" />
                <div className="w-full h-2/3 border-b border-white" />
                <div className="absolute top-0 left-1/3 h-full border-r border-white" />
                <div className="absolute top-0 left-2/3 h-full border-r border-white" />
              </div>

              {/* wrb_noi_bo bottom gradient overlay & badge */}
              <div className="absolute bottom-0 left-0 w-full p-5 bg-gradient-to-t from-[#131315] via-[#131315]/80 to-transparent pointer-events-none">
                <div className="inline-block bg-[#e6c487]/20 border border-[#e6c487]/40 px-3 py-1 rounded-full mb-1 backdrop-blur-sm">
                  <span className="text-xs font-bold tracking-wider text-[#e6c487]">{staffCode}</span>
                </div>
                {staffName && (
                  <h4 className="text-sm font-bold text-white truncate drop-shadow">{staffName}</h4>
                )}
                <p className="text-[10px] text-[#d0c5b5]/90 tracking-wide truncate">{subtitle}</p>
              </div>
            </div>

            {/* Controls Bar: Zoom & Reset */}
            <div className="w-full max-w-[320px] mt-4 p-3 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(1, prev - 0.2))}
                disabled={zoom <= 1}
                className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-zinc-800 transition-colors"
                title="Thu nhỏ"
              >
                <ZoomOut size={16} />
              </button>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[#e6c487]"
                />
                <span className="text-[10px] font-mono font-bold text-zinc-300 w-9 text-right">
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(3, prev + 0.2))}
                disabled={zoom >= 3}
                className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-zinc-800 transition-colors"
                title="Phóng to"
              >
                <ZoomIn size={16} />
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors border-l border-zinc-800 pl-2.5"
                title="Đặt lại vị trí ban đầu"
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
              >
                Hủy
              </button>
              {onUseOriginal && (
                <button
                  type="button"
                  onClick={onUseOriginal}
                  disabled={isProcessing}
                  className="px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-xl transition-colors"
                  title="Tải lên nguyên bản mà không cắt theo khung"
                >
                  Giữ ảnh gốc
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSaveCrop}
              disabled={isProcessing || !imageLoaded}
              className="px-5 py-2.5 bg-gradient-to-r from-[#d4af37] to-[#e6c487] hover:from-[#c59e2b] hover:to-[#d4af37] text-black text-xs font-bold rounded-xl shadow-lg shadow-[#d4af37]/20 flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            >
              <Check size={16} />
              <span>{isProcessing ? 'Đang xử lý...' : 'Áp dụng & Tải lên'}</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
