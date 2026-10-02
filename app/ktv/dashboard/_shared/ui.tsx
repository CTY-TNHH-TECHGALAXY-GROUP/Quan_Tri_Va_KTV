'use client';

import React from 'react';
import Image from 'next/image';
import { roomLabel } from '@/lib/room-label';

/**
 * Token giao diện + mảnh UI nhỏ dùng chung cho mọi màn của KTV Dashboard.
 * Tách khỏi page.tsx để các màn import chéo mà không kéo theo cả file 125KB.
 */

export const THEME = {
  primary: 'bg-emerald-600',
  primaryHover: 'hover:bg-emerald-700',
  primaryMuted: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  gold: 'text-[#D4AF37]',
  goldBg: 'bg-gradient-to-r from-[#D4AF37] to-[#F3E5AB]',
  goldBorder: 'border-[#D4AF37]/30',
  bgCard: 'bg-white',
  bgBase: 'bg-[#FDFBF7]',
  radius: 'rounded-[32px]',
  border: 'border-slate-100',
  textBase: 'text-slate-800',
  textMuted: 'text-slate-400'
};

export const ANIMATION = {
  duration: 0.4,
  initial: { opacity: 0, scale: 0.98, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 1.02, y: -10 }
};

/** URL dự phòng cho mã QR đặt lịch. */
export const DEFAULT_BOOKING_URL = 'https://nganha.vercel.app/';

/**
 * Gộp tên dịch vụ của nhiều chặng thành một dòng, gom theo phòng.
 * VD: 2 chặng cùng phòng T → "ẤN HUYỆT - GỘI ĐẦU T".
 */
export const formatMultiServiceNames = (segments: any[]) => {
  if (!segments || segments.length === 0) return '';
  if (segments.length === 1) return segments[0]?._serviceName || 'Dịch vụ';

  const groups = new globalThis.Map<string, Set<string>>();

  segments.forEach(seg => {
    const roomName = seg.roomId || '';
    const serviceName = seg._serviceName || 'Dịch vụ';

    if (!groups.has(roomName)) {
      groups.set(roomName, new Set());
    }
    groups.get(roomName)!.add(serviceName.toUpperCase());
  });

  const parts: string[] = [];
  groups.forEach((serviceSet: Set<string>, roomName: string) => {
    const servicesStr = Array.from(serviceSet).join(' - ');
    parts.push(roomName ? `${servicesStr} ${roomLabel(roomName)}` : servicesStr);
  });

  return parts.join(' + ');
};

export const WebBookingQR = ({ url }: { url: string }) => {
  return (
    <Image
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`}
      alt="Web Booking QR Code"
      width={160}
      height={160}
      className="rounded-2xl"
      referrerPolicy="no-referrer"
    />
  );
};

/** Nhãn loại dịch vụ suy ra từ tiền tố mã: NHP=VIP, NHT=Điều trị, NHS=Menu thường. */
export const ServiceTypeLabel = ({ serviceId }: { serviceId?: string }) => {
  if (!serviceId) return null;
  const prefix = String(serviceId).substring(0, 3).toUpperCase();
  if (prefix === 'NHP') return <span className="text-[10px] font-black text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">VIP</span>;
  if (prefix === 'NHT') return <span className="text-[10px] font-black text-blue-700 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">ĐIỀU TRỊ</span>;
  if (prefix === 'NHS') return <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">MENU THƯỜNG</span>;
  return null;
};
