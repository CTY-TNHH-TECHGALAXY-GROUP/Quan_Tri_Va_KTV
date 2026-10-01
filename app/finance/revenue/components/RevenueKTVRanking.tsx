import React from 'react';
import { useRevenueKTVRanking } from './RevenueKTVRanking.logic';
import { Trophy, Clock, Calendar, Star, DollarSign, Filter, Users, CalendarOff, Maximize2, Minimize2, ChevronDown, ChevronUp, Search, X } from 'lucide-react';

interface Props {
  dateFrom: string;
  dateTo: string;
  langFilter?: string;
}

const SORT_OPTIONS = [
  { value: 'revenue', label: 'Doanh thu (Cao nhất)' },
  { value: 'tuaMoney', label: 'Tiền tua (Cao nhất)' },
  { value: 'bonus', label: 'Điểm Bonus (Cao nhất)' },
  { value: 'totalWorkingHours', label: 'Tổng giờ làm (Cao nhất)' },
  { value: 'rating4Count', label: 'Mức 4 · Xuất sắc (Nhiều nhất)' },
  { value: 'rating3Count', label: 'Mức 3 · Tốt (Nhiều nhất)' },
  { value: 'rating2Count', label: 'Mức 2 · Bình thường (Nhiều nhất)' },
  { value: 'rating1Count', label: 'Mức 1 · Tệ (Nhiều nhất)' },
  { value: 'avgRating', label: 'Điểm đánh giá TB (Cao nhất)' },
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

  const [expandAll, setExpandAll] = React.useState(false);
  const [expandedCards, setExpandedCards] = React.useState<Record<string, boolean>>({});

  // 🏷️ Bộ lọc đa chọn mã nhân viên
  const [selectedStaffIds, setSelectedStaffIds] = React.useState<string[]>([]);
  const [isStaffDropdownOpen, setIsStaffDropdownOpen] = React.useState(false);
  const [staffSearchText, setStaffSearchText] = React.useState('');
  const staffDropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (staffDropdownRef.current && !staffDropdownRef.current.contains(e.target as Node)) {
        setIsStaffDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredData = React.useMemo(() => {
    if (selectedStaffIds.length === 0) return data;
    return data.filter(ktv => selectedStaffIds.includes(ktv.id));
  }, [data, selectedStaffIds]);

  // Danh sách KTV cho bộ lọc: xếp Hạng C xuống cuối cùng, các hạng khác xếp theo mã KTV
  const filterKtvList = React.useMemo(() => {
    return [...data].sort((a, b) => {
      const isAC = a.workType === 'TYPE_C' ? 1 : 0;
      const isBC = b.workType === 'TYPE_C' ? 1 : 0;
      if (isAC !== isBC) return isAC - isBC;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [data]);

  const toggleStaffSelect = (id: string) => {
    setSelectedStaffIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleCard = (id: string) => {
    setExpandedCards(prev => ({
      ...prev,
      [id]: expandAll ? false : !prev[id]
    }));
  };

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 flex items-center justify-center rounded-xl">
            <Trophy size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">Bảng Xếp Hạng KTV</h2>
            <p className="text-sm text-gray-500 font-medium">Đang hiển thị {filteredData.length}/{data.length} nhân viên theo tiêu chí</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Multi-select KTV Popover */}
          <div className="relative" ref={staffDropdownRef}>
            <button
              type="button"
              onClick={() => setIsStaffDropdownOpen(!isStaffDropdownOpen)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                selectedStaffIds.length > 0
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs'
                  : 'bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Users size={14} className={selectedStaffIds.length > 0 ? 'text-indigo-600' : 'text-gray-400'} />
              <span>
                {selectedStaffIds.length === 0
                  ? 'Lọc theo KTV'
                  : `Đã chọn (${selectedStaffIds.length}/${data.length})`}
              </span>
              <ChevronDown size={14} className={`transition-transform duration-200 ${isStaffDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isStaffDropdownOpen && (
              <div className="absolute right-0 sm:right-auto sm:left-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 z-30 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={staffSearchText}
                    onChange={(e) => setStaffSearchText(e.target.value)}
                    placeholder="Tìm tên hoặc mã KTV..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-bold text-gray-500 px-1 border-b border-gray-100 pb-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds(data.map(k => k.id))}
                    className="text-indigo-600 hover:underline cursor-pointer"
                  >
                    Chọn tất cả ({data.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds([])}
                    className="text-gray-500 hover:underline cursor-pointer"
                  >
                    Bỏ chọn
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {filterKtvList
                    .filter(k => 
                      k.name.toLowerCase().includes(staffSearchText.toLowerCase()) || 
                      k.id.toLowerCase().includes(staffSearchText.toLowerCase())
                    )
                    .map(ktv => {
                      const isSelected = selectedStaffIds.includes(ktv.id);
                      return (
                        <label
                          key={ktv.id}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                            isSelected ? 'bg-indigo-50 font-bold text-indigo-900' : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleStaffSelect(ktv.id)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="truncate">{ktv.name}</span>
                            <span className="text-[10px] text-gray-400 font-mono">({ktv.id})</span>
                          </div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                            ktv.workType === 'TYPE_D' ? 'bg-purple-100 text-purple-700' :
                            ktv.workType === 'TYPE_B' ? 'bg-emerald-100 text-emerald-700' :
                            ktv.workType === 'TYPE_C' ? 'bg-amber-100 text-amber-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {ktv.workType === 'TYPE_D' ? 'D' : ktv.workType === 'TYPE_B' ? 'B' : ktv.workType === 'TYPE_C' ? 'C' : 'A'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {selectedStaffIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedStaffIds([])}
              className="text-xs text-rose-600 font-bold hover:underline flex items-center gap-1 cursor-pointer bg-rose-50 px-2.5 py-2 rounded-xl"
            >
              <X size={12} /> Bỏ lọc ({selectedStaffIds.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpandAll(!expandAll)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            {expandAll ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{expandAll ? 'Thu gọn chi tiết' : 'Mở rộng tất cả chi tiết'}</span>
          </button>
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

      {filteredData.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Users size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">
            {selectedStaffIds.length > 0 ? 'Không có KTV nào phù hợp với bộ lọc' : 'Không có dữ liệu KTV trong khoảng thời gian này'}
          </p>
          {selectedStaffIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedStaffIds([])}
              className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 cursor-pointer"
            >
              Xóa bộ lọc KTV
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Desktop View: Giữ nguyên 100% bảng 10 cột */}
          <div className="hidden lg:block overflow-x-auto">
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
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Tổng Giờ Làm</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-left min-w-[190px]">Đánh Giá (Feedback)</th>
                  <th className="p-4 text-xs font-black text-gray-400 uppercase tracking-widest text-left min-w-[130px]">Lượt Tua</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredData.map((ktv, index) => {
                  const isTop1 = index === 0;
                  const isTop2 = index === 1;
                  const isTop3 = index === 2;
                  
                  const count4 = ktv.rating4Count ?? ktv.excellentCount ?? 0;
                  const count3 = ktv.rating3Count ?? ktv.goodCount ?? 0;
                  const count2 = ktv.rating2Count ?? ktv.averageCount ?? 0;
                  const count1 = ktv.rating1Count ?? ktv.badCount ?? 0;
                  const totalRatings = ktv.ratingCount ?? (count4 + count3 + count2 + count1);

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
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors leading-tight">{ktv.name}</span>
                            <div className={`h-1 w-7 rounded-full my-1 ${
                              ktv.workType === 'TYPE_D' ? 'bg-purple-500' :
                              ktv.workType === 'TYPE_B' ? 'bg-emerald-500' :
                              ktv.workType === 'TYPE_C' ? 'bg-amber-500' :
                              'bg-blue-500'
                            }`} />
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
                          <div className="flex items-center gap-1 text-indigo-600 font-black" title="Tổng số giờ lên khách">
                            <Clock size={14} />
                            {ktv.totalWorkingHours}h
                          </div>
                          <div className="text-[10px] text-gray-400 font-medium mt-0.5">TB {ktv.avgWorkingHours}h/ngày</div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1 text-xs font-medium">
                          {totalRatings > 0 ? (
                            <div className="flex items-center gap-1.5 mb-0.5 pb-1 border-b border-gray-100">
                              <span className="text-[11px] font-black text-amber-600 flex items-center gap-0.5">
                                <Star size={11} className="fill-amber-400 text-amber-400" />
                                {ktv.avgRating > 0 ? ktv.avgRating.toFixed(1) : '0'}★
                              </span>
                              <span className="text-[10px] text-gray-400 font-semibold">({totalRatings} lượt)</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between items-center text-amber-700 bg-amber-50/80 px-2 py-0.5 rounded text-[11px]">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="text-amber-500">4★</span>
                              <span className="text-gray-600">Xuất sắc:</span>
                            </span>
                            <span className="font-black text-amber-700">{count4}</span>
                          </div>
                          <div className="flex justify-between items-center text-emerald-700 bg-emerald-50/80 px-2 py-0.5 rounded text-[11px]">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="text-emerald-500">3★</span>
                              <span className="text-gray-600">Tốt:</span>
                            </span>
                            <span className="font-black text-emerald-700">{count3}</span>
                          </div>
                          <div className="flex justify-between items-center text-sky-700 bg-sky-50/80 px-2 py-0.5 rounded text-[11px]">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="text-sky-500">2★</span>
                              <span className="text-gray-600">B.Thường:</span>
                            </span>
                            <span className="font-black text-sky-700">{count2}</span>
                          </div>
                          <div className="flex justify-between items-center text-rose-700 bg-rose-50/80 px-2 py-0.5 rounded text-[11px]">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="text-rose-500">1★</span>
                              <span className="text-gray-600">Tệ:</span>
                            </span>
                            <span className="font-black text-rose-700">{count1}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1 text-xs font-medium">
                          <div className="flex justify-between items-center text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                            <span>Tour tự do:</span>
                            <span className="font-bold text-slate-800">{ktv.freeTurns}</span>
                          </div>
                          <div className="flex justify-between items-center text-purple-700 bg-purple-50 px-2 py-1 rounded-md">
                            <span>Menu VIP:</span>
                            <span className="font-black text-purple-800">{ktv.vipTurns}</span>
                          </div>
                          <div className="flex justify-between items-center text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                            <span>Yêu cầu:</span>
                            <span className="font-bold text-blue-800">{ktv.requestedTurns}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile View: Dạng Card thông minh có thể bung chi tiết */}
          <div className="block lg:hidden divide-y divide-gray-100">
            {filteredData.map((ktv, index) => {
              const isTop1 = index === 0;
              const isTop2 = index === 1;
              const isTop3 = index === 2;
              const isExpanded = expandAll || !!expandedCards[ktv.id];

              const count4 = ktv.rating4Count ?? ktv.excellentCount ?? 0;
              const count3 = ktv.rating3Count ?? ktv.goodCount ?? 0;
              const count2 = ktv.rating2Count ?? ktv.averageCount ?? 0;
              const count1 = ktv.rating1Count ?? ktv.badCount ?? 0;
              const totalRatings = ktv.ratingCount ?? (count4 + count3 + count2 + count1);

              return (
                <div key={ktv.id} className="p-4 space-y-3">
                  <div 
                    onClick={() => toggleCard(ktv.id)}
                    className="flex items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 text-center shrink-0">
                        {isTop1 ? (
                          <span className="w-7 h-7 bg-amber-100 text-amber-600 rounded-full inline-flex items-center justify-center font-black text-xs">1</span>
                        ) : isTop2 ? (
                          <span className="w-7 h-7 bg-slate-200 text-slate-600 rounded-full inline-flex items-center justify-center font-black text-xs">2</span>
                        ) : isTop3 ? (
                          <span className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full inline-flex items-center justify-center font-black text-xs">3</span>
                        ) : (
                          <span className="text-gray-400 font-bold text-xs">#{index + 1}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 truncate leading-tight">{ktv.name}</div>
                        <div className={`h-1 w-6 rounded-full my-1 ${
                          ktv.workType === 'TYPE_D' ? 'bg-purple-500' :
                          ktv.workType === 'TYPE_B' ? 'bg-emerald-500' :
                          ktv.workType === 'TYPE_C' ? 'bg-amber-500' :
                          'bg-blue-500'
                        }`} />
                        <div className="text-[11px] text-gray-400">Mã: {ktv.id}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="font-black text-gray-900 text-sm">{Math.round(ktv.revenue).toLocaleString('vi-VN')}đ</div>
                        <div className="text-[11px] font-bold text-emerald-600">{Math.round(ktv.tuaMoney).toLocaleString('vi-VN')}đ tua</div>
                      </div>
                      <div className="text-gray-400">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>
                  </div>

                  {/* Khối chi tiết mở rộng */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-gray-100 space-y-2 text-xs animate-in fade-in duration-200">
                      <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-xl text-center">
                        <div>
                          <div className="text-[10px] text-gray-400 font-semibold">Ngày công</div>
                          <div className="font-bold text-gray-800">{ktv.workingDays}d ({ktv.leaveDays} nghỉ)</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 font-semibold">Giờ làm</div>
                          <div className="font-bold text-indigo-600">{ktv.totalWorkingHours}h</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 font-semibold">Điểm Bonus</div>
                          <div className="font-bold text-orange-500">{Math.round(ktv.bonus)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-amber-50/60 p-2 rounded-xl">
                          <div className="font-bold text-amber-800 text-[11px] mb-1 flex items-center gap-1">
                            <Star size={11} className="fill-amber-400 text-amber-400" /> Đánh giá ({totalRatings})
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[10px]">
                            <span>4★: <b>{count4}</b></span>
                            <span>3★: <b>{count3}</b></span>
                            <span>2★: <b>{count2}</b></span>
                            <span>1★: <b>{count1}</b></span>
                          </div>
                        </div>
                        <div className="bg-blue-50/60 p-2 rounded-xl">
                          <div className="font-bold text-blue-800 text-[11px] mb-1">Lượt tua</div>
                          <div className="space-y-0.5 text-[10px] text-gray-700">
                            <div>Tự do: <b>{ktv.freeTurns}</b></div>
                            <div>VIP: <b>{ktv.vipTurns}</b></div>
                            <div>Yêu cầu: <b>{ktv.requestedTurns}</b></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
