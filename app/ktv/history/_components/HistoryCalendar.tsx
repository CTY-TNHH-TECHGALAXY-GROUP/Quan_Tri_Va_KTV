import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getVnDateStr } from '@/lib/time.logic';

const MONTH_NAMES = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

interface HistoryCalendarProps {
  selectedDates: string[];
  onSelectDates: (dates: string[], isComplete?: boolean) => void;
}

export const HistoryCalendar: React.FC<HistoryCalendarProps> = ({ selectedDates, onSelectDates }) => {
  const todayStr = getVnDateStr();
  const initDate = new Date(selectedDates.length > 0 ? selectedDates[0] : todayStr);
  const [localDates, setLocalDates] = useState<string[]>(selectedDates);
  const isDragging = useRef(false);
  const dragMode = useRef<'add' | 'remove'>('add');
  
  useEffect(() => {
    setLocalDates(selectedDates);
  }, [selectedDates]);

  const [calendarMonth, setCalendarMonth] = useState({
    year: initDate.getFullYear(),
    month: initDate.getMonth()
  });

  const { year, month } = calendarMonth;
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();

  let startDow = firstDayOfMonth.getDay(); 
  startDow = startDow === 0 ? 6 : startDow - 1; 

  const goToPrevMonth = () => {
    setCalendarMonth(prev => {
      let m = prev.month - 1;
      let y = prev.year;
      if (m < 0) { m = 11; y--; }
      return { year: y, month: m };
    });
  };

  const goToNextMonth = () => {
    setCalendarMonth(prev => {
      let m = prev.month + 1;
      let y = prev.year;
      if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  };

  const goToToday = () => {
    const today = new Date();
    setCalendarMonth({ year: today.getFullYear(), month: today.getMonth() });
  };

  // Hàm hỗ trợ tương tác chọn bằng cách vuốt/click
  const handleInteract = (dateStr: string, isTouchMove = false) => {
    if (dateStr > todayStr) return;
    setLocalDates(prev => {
      const exists = prev.includes(dateStr);
      if (isTouchMove) {
        if (dragMode.current === 'add' && !exists) return [...prev, dateStr];
        if (dragMode.current === 'remove' && exists) return prev.filter(d => d !== dateStr);
        return prev;
      } else {
        return exists ? prev.filter(d => d !== dateStr) : [...prev, dateStr];
      }
    });
  };

  const onTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging.current) return;
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (el) {
      const btn = el.closest('[data-date]');
      if (btn) {
        const dateStr = btn.getAttribute('data-date');
        if (dateStr) handleInteract(dateStr, true);
      }
    }
  };

  useEffect(() => {
    const stopDrag = () => { isDragging.current = false; };
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchend', stopDrag);
    };
  }, []);

  return (
    <div 
      className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mb-4 select-none touch-none"
      onMouseMove={onTouchMove}
      onTouchMove={onTouchMove}
    >
      <div className="px-5 py-4 border-b border-gray-100 flex flex-col items-center gap-2">
        <div className="flex items-center justify-between w-full">
          <button onClick={goToPrevMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ChevronLeft size={18} className="text-gray-500" />
          </button>
          <button onClick={goToToday} className="text-sm font-bold text-gray-800 px-3 py-1.5 hover:bg-gray-50 rounded-xl transition-colors">
            {MONTH_NAMES[month]} {year}
          </button>
          <button onClick={goToNextMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ChevronRight size={18} className="text-gray-500" />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 font-medium bg-gray-50 px-3 py-1 rounded-full text-center">
          Chạm từng ngày hoặc lướt (vuốt) để chọn nhiều ngày
        </p>
      </div>

      <div className="px-4 py-4">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {WEEKDAY_LABELS.map((day, i) => (
            <div key={day} className={`text-center text-[10px] font-bold uppercase tracking-wider py-1 ${i === 6 ? 'text-red-400' : i === 5 ? 'text-blue-400' : 'text-gray-400'}`}>
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startDow }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isFuture = dateStr > todayStr;
            const dow = (startDow + i) % 7; 
            
            const isSelected = localDates.includes(dateStr);
            let cellStyle = 'text-gray-700 hover:bg-gray-50';
            
            if (isSelected) {
              cellStyle = 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-200 scale-105';
            } else if (isFuture) {
              cellStyle = 'text-gray-300 bg-gray-50/30 cursor-not-allowed';
            } else if (isToday) {
              cellStyle = 'bg-indigo-50 text-indigo-700 border-2 border-indigo-300 font-black';
            } else if (dow === 6) {
              cellStyle = 'text-red-400 hover:bg-red-50/50';
            } else if (dow === 5) {
              cellStyle = 'text-blue-400 hover:bg-blue-50/50';
            }

            return (
              <button
                key={dateStr}
                data-date={dateStr}
                onPointerDown={(e) => {
                  if (!isFuture) {
                    isDragging.current = true;
                    dragMode.current = isSelected ? 'remove' : 'add';
                    handleInteract(dateStr);
                  }
                }}
                disabled={isFuture}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all text-sm ${cellStyle}`}
              >
                <span className="leading-none pointer-events-none">{day}</span>
              </button>
            );
          })}
        </div>
      </div>
      
      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <button
          onClick={() => onSelectDates(localDates, true)}
          disabled={localDates.length === 0}
          className={`w-full py-3.5 font-bold rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 ${localDates.length > 0 ? 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow-indigo-200' : 'bg-gray-200 text-gray-400 shadow-none cursor-not-allowed'}`}
        >
          XEM KẾT QUẢ ({localDates.length} ngày)
        </button>
      </div>
    </div>
  );
};
