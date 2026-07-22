'use client';

// 🔧 UI CONFIGURATION
const START_HOUR = 8;              // Giờ bắt đầu hiển thị
const END_HOUR = 24;               // Giờ kết thúc hiển thị (24:00 = nửa đêm)
const PIXELS_PER_MINUTE = 2;       // Mỗi phút = 2px chiều cao
const CARD_MIN_HEIGHT = 40;        // Chiều cao tối thiểu cho booking card (px)
const DAY_CARD_MIN_HEIGHT = 60;    // Min height cho day-view card (px) — rộng hơn hiển thị nhiều hơn

import React, { useMemo } from 'react';
import { WebBooking } from './actions';

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  NEW:         { border: 'border-l-orange-400', bg: 'bg-orange-50',  badge: 'bg-orange-100 text-orange-700', badgeText: '⏳ Chờ xác nhận' },
  PREPARING:   { border: 'border-l-violet-400', bg: 'bg-violet-50',  badge: 'bg-violet-100 text-violet-700',badgeText: '⚡ Chuẩn bị' },
  IN_PROGRESS: { border: 'border-l-emerald-400',bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', badgeText: '▶ Đang phục vụ' },
  COMPLETED:   { border: 'border-l-purple-400', bg: 'bg-purple-50',  badge: 'bg-purple-100 text-purple-700',badgeText: '🧹 Dọn phòng' },
  DONE:        { border: 'border-l-gray-300',   bg: 'bg-gray-50',    badge: 'bg-gray-100 text-gray-500',   badgeText: '✓ Hoàn tất' },
  FEEDBACK:    { border: 'border-l-gray-300',   bg: 'bg-gray-50',    badge: 'bg-gray-100 text-gray-500',   badgeText: '⭐ Đánh giá' },
  CANCELLED:   { border: 'border-l-red-400',    bg: 'bg-red-50',     badge: 'bg-red-100 text-red-700',     badgeText: '✕ Đã hủy' },
} as const;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Get YYYY-MM-DD using LOCAL timezone (not UTC) to avoid midnight boundary bugs */
const toDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getBookingDateKey = (booking: WebBooking): string =>
  booking.bookingDate.substring(0, 10);

const getWeekDays = (weekStart: Date): Date[] =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const DAY_LABELS_FULL = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const VIET_MONTHS = ['Th.1','Th.2','Th.3','Th.4','Th.5','Th.6','Th.7','Th.8','Th.9','Th.10','Th.11','Th.12'];

// ─── PROPS ────────────────────────────────────────────────────────────────────

export type CalendarViewMode = 'week' | 'day';

interface WebBookingCalendarProps {
  bookings: WebBooking[];
  viewMode: CalendarViewMode;
  weekStart: Date;    // Monday of the displayed week
  selectedDay: Date;  // The day shown in day-view
  onCardClick: (booking: WebBooking) => void;
}

// ─── SHARED: TIME GRID ────────────────────────────────────────────────────────

const TimeGrid = ({ totalHeight, hourLabels }: { totalHeight: number; hourLabels: number[] }) => (
  <div className="w-16 shrink-0 border-r border-gray-100 relative bg-white z-10" style={{ height: totalHeight }}>
    {hourLabels.map((h) => {
      const top = (h - START_HOUR) * 60 * PIXELS_PER_MINUTE;
      return (
        <div
          key={h}
          className="absolute w-full text-right pr-3 text-[11px] text-gray-400 font-medium"
          style={{ top: top - 8 }}
        >
          {h === 24 ? '24:00' : `${String(h).padStart(2, '0')}:00`}
        </div>
      );
    })}
  </div>
);

const HourGridLines = ({ hourLabels, totalHeight, isDay }: { hourLabels: number[]; totalHeight: number; isDay?: boolean }) => (
  <>
    {hourLabels.map((h) => {
      const top = (h - START_HOUR) * 60 * PIXELS_PER_MINUTE;
      // Vẽ nửa giờ (30 phút) bằng đường nhạt hơn trong day view
      return (
        <React.Fragment key={h}>
          <div
            className="absolute w-full border-t border-gray-100 pointer-events-none"
            style={{ top, zIndex: 0 }}
          />
          {isDay && h < END_HOUR && (
            <div
              className="absolute w-full border-t border-gray-50 pointer-events-none"
              style={{ top: top + 30 * PIXELS_PER_MINUTE, zIndex: 0 }}
            />
          )}
        </React.Fragment>
      );
    })}
  </>
);

const CurrentTimeLine = ({ nowTop, now }: { nowTop: number; now: Date }) => (
  <div className="absolute w-full pointer-events-none z-20" style={{ top: nowTop }}>
    <div className="relative flex items-center">
      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full -ml-1.5 shrink-0 shadow-md" />
      <div className="flex-1 border-t-2 border-blue-400" />
    </div>
    <div className="absolute -left-16 -top-2.5 w-14 text-right">
      <span className="text-[10px] font-black text-blue-500">
        {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
      </span>
    </div>
  </div>
);

// ─── BOOKING CARD (WEEK VIEW — compact) ──────────────────────────────────────

const WeekBookingCard = ({
  booking, height, top, onCardClick,
}: {
  booking: WebBooking; height: number; top: number; onCardClick: (b: WebBooking) => void;
}) => {
  const style = STATUS_STYLE[booking.status] ?? STATUS_STYLE.NEW;
  const timeStr = booking.timeBooking ?? '08:00';
  return (
    <div
      onClick={() => onCardClick(booking)}
      className={`absolute left-[4%] w-[92%] ${style.bg} border border-gray-100 border-l-4 ${style.border} rounded-lg cursor-pointer hover:shadow-md hover:scale-[1.01] transition-all overflow-hidden p-2 z-10`}
      style={{ top, height }}
    >
      <p className="text-[10px] text-gray-500 font-medium leading-none mb-1">{timeStr}</p>
      <p className="text-[11px] font-black text-gray-800 leading-tight truncate">{booking.customerName}</p>
      {height > 55 && booking.items.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {booking.items.slice(0, 2).map((item) => (
            <p key={item.id} className="text-[10px] text-gray-500 leading-tight truncate">
              · {item.serviceName}{item.duration ? ` (${item.duration}p)` : ''}
            </p>
          ))}
          {booking.items.length > 2 && (
            <p className="text-[9px] text-gray-400 italic">+{booking.items.length - 2} dịch vụ</p>
          )}
        </div>
      )}
      {height > 90 && (
        <div className={`mt-1.5 ${style.badge} text-[9px] font-bold px-1.5 py-0.5 rounded w-fit`}>
          {style.badgeText}
        </div>
      )}
    </div>
  );
};

// ─── BOOKING CARD (DAY VIEW — full detail) ────────────────────────────────────

const DayBookingCard = ({
  booking, height, top, onCardClick,
}: {
  booking: WebBooking; height: number; top: number; onCardClick: (b: WebBooking) => void;
}) => {
  const style = STATUS_STYLE[booking.status] ?? STATUS_STYLE.NEW;
  const timeStr = booking.timeBooking ?? '08:00';
  const totalDuration = booking.items.reduce((s, i) => s + i.duration, 0) || 60;

  return (
    <div
      onClick={() => onCardClick(booking)}
      className={`absolute left-[2%] w-[96%] ${style.bg} border border-gray-200 border-l-4 ${style.border} rounded-xl cursor-pointer hover:shadow-lg transition-all overflow-hidden z-10`}
      style={{ top, height }}
    >
      <div className="p-3 h-full flex flex-col gap-1">
        {/* Header: time + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 font-bold">
            {timeStr} · ~{totalDuration}p
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
            {style.badgeText}
          </span>
        </div>

        {/* Customer name */}
        <p className="font-black text-sm text-gray-900 leading-tight truncate">
          {booking.customerName}
        </p>

        {/* Services — full list in day view */}
        {height > DAY_CARD_MIN_HEIGHT && booking.items.length > 0 && (
          <div className="mt-0.5 space-y-1 flex-1 overflow-hidden">
            {booking.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-600 truncate">· {item.serviceName}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{item.duration}p</span>
              </div>
            ))}
          </div>
        )}

        {/* Total + billCode footer */}
        {height > 100 && (
          <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-100">
            <span className="text-[10px] text-gray-400 font-mono">{booking.billCode}</span>
            <span className="text-[11px] font-black text-gray-800">
              {formatVND(booking.totalAmount)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const WebBookingCalendar = ({
  bookings, viewMode, weekStart, selectedDay, onCardClick,
}: WebBookingCalendarProps) => {
  const today = toDateKey(new Date());
  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE;
  const weekDays = getWeekDays(weekStart);
  const hourLabels = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  // Current time
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() - START_HOUR * 60;
  const nowTop = nowMinutes * PIXELS_PER_MINUTE;
  const isNowVisible = nowMinutes >= 0 && nowMinutes <= totalMinutes;

  // Group bookings by date
  const bookingsByDate = useMemo(() => {
    const grouped: Record<string, WebBooking[]> = {};
    for (const b of bookings) {
      if (b.status === 'CANCELLED') continue;
      const dateKey = getBookingDateKey(b);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(b);
    }
    return grouped;
  }, [bookings]);

  // ── DAY VIEW ────────────────────────────────────────────────────────────────

  if (viewMode === 'day') {
    const dayKey = toDateKey(selectedDay);
    const isToday = dayKey === today;
    const dayBookings = bookingsByDate[dayKey] ?? [];
    const dayLabel = (() => {
      const dow = selectedDay.getDay();
      const label = DAY_LABELS_FULL[dow === 0 ? 6 : dow - 1];
      return `${label}, ${selectedDay.getDate()} ${VIET_MONTHS[selectedDay.getMonth()]} ${selectedDay.getFullYear()}`;
    })();

    return (
      <div className="flex flex-col h-full overflow-hidden bg-white rounded-2xl border border-gray-200">
        {/* Day header */}
        <div className="flex border-b border-gray-200 shrink-0">
          <div className="w-16 shrink-0 p-3 border-r border-gray-100">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider">GMT+7</span>
          </div>
          <div className={`flex-1 flex flex-col items-center justify-center py-3 ${isToday ? 'bg-blue-50' : ''}`}>
            <p className={`text-sm font-black ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
              {dayLabel}
            </p>
            <p className={`text-[10px] font-medium mt-0.5 ${isToday ? 'text-blue-400' : 'text-gray-400'}`}>
              {dayBookings.length} đơn trong ngày
            </p>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          <TimeGrid totalHeight={totalHeight} hourLabels={hourLabels} />

          {/* Single day column */}
          <div className="flex-1 relative" style={{ height: totalHeight }}>
            <HourGridLines hourLabels={hourLabels} totalHeight={totalHeight} isDay />

            {isNowVisible && isToday && (
              <CurrentTimeLine nowTop={nowTop} now={now} />
            )}

            {dayBookings.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-300">
                  <p className="text-4xl mb-2">📭</p>
                  <p className="text-sm font-medium">Không có đơn nào</p>
                </div>
              </div>
            ) : (
              dayBookings.map((booking) => {
                const timeStr = booking.timeBooking ?? '08:00';
                const startMins = timeToMinutes(timeStr) - START_HOUR * 60;
                const duration = booking.items.reduce((s, i) => s + i.duration, 0) || 60;
                const top = Math.max(0, startMins * PIXELS_PER_MINUTE);
                const height = Math.max(DAY_CARD_MIN_HEIGHT, duration * PIXELS_PER_MINUTE);
                if (startMins < 0 || startMins > totalMinutes) return null;
                return (
                  <DayBookingCard
                    key={booking.id}
                    booking={booking}
                    height={height}
                    top={top}
                    onCardClick={onCardClick}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── WEEK VIEW (default) ──────────────────────────────────────────────────────

  const formatDayHeader = (d: Date, shortLabel: string) => {
    const dateKey = toDateKey(d);
    const isToday = dateKey === today;
    return (
      <div key={dateKey} className="flex-1 min-w-0 border-r border-gray-100 last:border-r-0">
        <div className={`flex flex-col items-center py-3 ${isToday ? 'bg-blue-50' : ''}`}>
          <span className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>
            {shortLabel}
          </span>
          <span className={`text-lg font-black leading-none ${isToday ? 'text-white bg-blue-500 w-8 h-8 rounded-full flex items-center justify-center text-base' : 'text-gray-800'}`}>
            {d.getDate()}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white rounded-2xl border border-gray-200">
      {/* Week day headers */}
      <div className="flex border-b border-gray-200 shrink-0">
        <div className="w-16 shrink-0 p-3 border-r border-gray-100">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider">GMT+7</span>
        </div>
        {weekDays.map((d, i) => formatDayHeader(d, DAY_LABELS[i]))}
      </div>

      {/* Scrollable body */}
      <div className="flex flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <TimeGrid totalHeight={totalHeight} hourLabels={hourLabels} />

        <div className="flex flex-1 relative" style={{ height: totalHeight }}>
          <HourGridLines hourLabels={hourLabels} totalHeight={totalHeight} />

          {isNowVisible && <CurrentTimeLine nowTop={nowTop} now={now} />}

          {weekDays.map((d) => {
            const dateKey = toDateKey(d);
            const isToday = dateKey === today;
            const dayBookings = bookingsByDate[dateKey] ?? [];

            return (
              <div
                key={dateKey}
                className={`flex-1 min-w-0 border-r border-gray-100 last:border-r-0 relative ${isToday ? 'bg-blue-50/20' : ''}`}
              >
                {dayBookings.map((booking) => {
                  const timeStr = booking.timeBooking ?? '08:00';
                  const startMins = timeToMinutes(timeStr) - START_HOUR * 60;
                  const duration = booking.items.reduce((s, i) => s + i.duration, 0) || 60;
                  const top = Math.max(0, startMins * PIXELS_PER_MINUTE);
                  const height = Math.max(CARD_MIN_HEIGHT, duration * PIXELS_PER_MINUTE);
                  if (startMins < 0 || startMins > totalMinutes) return null;
                  return (
                    <WeekBookingCard
                      key={booking.id}
                      booking={booking}
                      height={height}
                      top={top}
                      onCardClick={onCardClick}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WebBookingCalendar;
