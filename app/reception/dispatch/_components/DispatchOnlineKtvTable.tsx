'use client';

import React, { useState, useEffect } from 'react';
import { StaffData } from '../types';
import { Clock, Navigation, MapPin } from 'lucide-react';

interface DispatchOnlineKtvTableProps {
  staffs: StaffData[];
}

export const DispatchOnlineKtvTable = ({ staffs }: DispatchOnlineKtvTableProps) => {
  // Chỉ lấy những KTV có trạng thái ONLINE
  const onlineStaffs = staffs.filter(s => s.online_status === 'ONLINE');
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000); // 1 minute
    return () => clearInterval(timer);
  }, []);

  if (onlineStaffs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8 space-y-4">
        <Navigation size={48} className="opacity-20" />
        <p className="text-center text-sm">Không có KTV nào đang bật Online sẵn sàng ở ngoài giờ.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-lg font-black text-indigo-900 flex items-center gap-2">
            <Navigation size={20} className="text-indigo-600" />
            KTV Đang Online
          </h2>
          <p className="text-xs text-gray-500 font-medium">Chờ book (Ở nhà / Khác)</p>
        </div>
        <div className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">
          {onlineStaffs.length} KTV
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1">
        {onlineStaffs.map(staff => {
            const untilMs = staff.available_until ? new Date(staff.available_until).getTime() : 0;
            const remainingMins = Math.max(0, Math.floor((untilMs - now) / 60000));
            const isExpired = remainingMins === 0;

            return (
              <div key={staff.id} className={`p-4 border rounded-2xl transition-all shadow-sm flex items-center justify-between ${isExpired ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-indigo-100 hover:shadow-md'}`}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-100 border border-indigo-200 flex items-center justify-center shadow-inner overflow-hidden">
                      {staff.avatar_url ? (
                        <img src={staff.avatar_url} alt={staff.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="font-black text-indigo-700 text-lg">{staff.id}</span>
                      )}
                    </div>
                    {!isExpired && (
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full"></span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-black text-gray-900 text-sm">{staff.full_name}</h3>
                    <p className="text-xs text-gray-500 font-medium mt-0.5">Mã: {staff.id}</p>
                    {staff.available_from && staff.available_until && (
                      <p className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1 w-max mt-1 border border-indigo-100">
                        <Clock size={10} />
                        Khung giờ: {new Date(staff.available_from).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})} - {new Date(staff.available_until).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right flex flex-col items-end gap-1.5">
                  <div className="bg-amber-100 text-amber-700 text-xs font-black px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-amber-200 shadow-sm">
                    <MapPin size={12} strokeWidth={3} />
                    +{staff.travel_minutes || 0} phút
                  </div>
                  {!isExpired ? (
                      <div className="text-[10px] font-bold text-gray-400">
                          Còn lại {Math.floor(remainingMins/60)}h{remainingMins%60}m
                      </div>
                  ) : (
                      <div className="text-[10px] font-bold text-rose-500">
                          Đã hết giờ
                      </div>
                  )}
                </div>
              </div>
            );
        })}
      </div>
    </div>
  );
};
