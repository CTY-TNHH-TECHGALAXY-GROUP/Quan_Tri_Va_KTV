import React from 'react';
import { useRevenueKTVRanking } from './RevenueKTVRanking.logic';
import { Trophy, Clock, Calendar, Star, DollarSign, Filter, Users, CalendarOff } from 'lucide-react';

interface Props {
  dateFrom: string;
  dateTo: string;
  langFilter?: string;
}

const SORT_OPTIONS = [
  { value: 'revenue', label: 'Doanh thu (Cao nhất)' },
  { value: 'tuaMoney', label: 'Tiền tua (Cao nhất)' },
  { value: 'bonus', label: 'Điểm Bonus (Cao nhất)' },
  { value: 'avgWorkingHours', label: 'Giờ làm/Ngày (Cao nhất)' },
  { value: 'workingDays', label: 'Ngày công (Nhiều nhất)' },
  { value: 'leaveDays', label: 'Ngày nghỉ (Nhiều nhất)' },
  { value: 'requestedTurns', label: 'Khách yêu cầu (Nhiều nhất)' },
  { value: 'vipTurns', label: 'Khách VIP (Nhiều nhất)' },
];

export const RevenueKTVRanking: React.FC<Props> = ({ dateFrom, dateTo, langFilter }) => {
  const { 
    data, isLoading, error, sortBy, setSortBy
  } = useRevenueKTVRanking(dateFrom, dateTo, langFilter);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-indigo-500 animate-pulse">
        <Users size={32} className="mb-2" />
        <span className="font-medium">Đang tải bảng xếp hạng...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-500 p-4 rounded-xl border border-red-100 flex items-center justify-center">
        <span className="font-medium">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 flex items-center justify-center rounded-xl">
            <Trophy size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">Bảng Xếp Hạng KTV</h2>
            <p className="text-sm text-gray-500 font-medium">Đánh giá hiệu suất nhân viên theo tiêu chí</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">

          <div className="flex items-center gap-2 sm:border-l border-gray-200 sm:pl-4">
            <span className="text-sm font-bold text-gray-600 hidden sm:block">Tiêu chí:</span>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="pl-9 pr-8 py-2.5 bg-gray-50 border-none rounded-xl text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-100 cursor-pointer hover:bg-gray-100 transition-colors"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      </div>

      {data.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Users size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">Không có dữ liệu KTV trong khoảng thời gian này</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-100">
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest w-16 text-center">Top</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest min-w-[200px]">Nhân viên</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Doanh Thu</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Tiền Tua</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Điểm Bonus</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Ngày Công</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Ngày Nghỉ</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Giờ TB/Ngày</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center min-w-[150px]">Lượt khách</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map((ktv, index) => {
                  const isTop1 = index === 0;
                  const isTop2 = index === 1;
                  const isTop3 = index === 2;
                  
                  return (
                    <tr key={ktv.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="p-4 text-center">
                        {isTop1 ? (
                          <div className="w-8 h-8 mx-auto bg-amber-100 text-amber-500 rounded-full flex items-center justify-center font-black text-sm shadow-sm ring-4 ring-amber-50">1</div>
                        ) : isTop2 ? (
                          <div className="w-8 h-8 mx-auto bg-slate-200 text-slate-500 rounded-full flex items-center justify-center font-black text-sm">2</div>
                        ) : isTop3 ? (
                          <div className="w-8 h-8 mx-auto bg-orange-100 text-orange-500 rounded-full flex items-center justify-center font-black text-sm">3</div>
                        ) : (
                          <div className="w-8 h-8 mx-auto text-gray-400 font-bold text-sm flex items-center justify-center">{index + 1}</div>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm uppercase ${isTop1 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'}`}>
                            {ktv.name.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{ktv.name}</div>
                            <div className="text-xs text-gray-400 font-medium">Mã: {ktv.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="font-black text-gray-900">{Math.round(ktv.revenue).toLocaleString('vi-VN')}đ</div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="font-bold text-emerald-600 bg-emerald-50 inline-block px-2 py-1 rounded-lg">
                          {Math.round(ktv.tuaMoney).toLocaleString('vi-VN')}đ
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="font-bold text-orange-500 bg-orange-50 inline-block px-2 py-1 rounded-lg">
                          {Math.round(ktv.bonus).toLocaleString('vi-VN')}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-gray-700 font-bold">
                          <Calendar size={14} className="text-gray-400" />
                          {ktv.workingDays}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className={`flex items-center justify-center gap-1 font-bold ${ktv.leaveDays > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                          <CalendarOff size={14} className={ktv.leaveDays > 0 ? 'text-red-400' : 'text-gray-300'} />
                          {ktv.leaveDays}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="flex items-center gap-1 text-indigo-600 font-black">
                            <Clock size={14} />
                            {ktv.avgWorkingHours}h
                          </div>
                          <div className="text-[10px] text-gray-400 font-medium mt-0.5">Mỗi ngày</div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1.5 text-xs font-medium">
                          <div className="flex justify-between items-center text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                            <span>Khách yêu cầu:</span>
                            <span className="font-black">{ktv.requestedTurns}</span>
                          </div>
                          <div className="flex justify-between items-center text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                            <span>Tour tự do:</span>
                            <span className="font-bold">{ktv.freeTurns}</span>
                          </div>
                          <div className="flex justify-between items-center text-purple-600 bg-purple-50 px-2 py-1 rounded-md">
                            <span>Menu VIP:</span>
                            <span className="font-black">{ktv.vipTurns}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
