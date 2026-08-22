import React from 'react';
import { BedDouble, Clock, User, Sparkles, CheckCircle2 } from 'lucide-react';
import { Room, Bed, RoomOccupancy } from './RoomBoard.types';
import { useRoomBoard } from './RoomBoard.logic';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.3;

interface RoomBoardProps {
  rooms: Room[];
  beds: Bed[];
  occupancies: RoomOccupancy[];
}

export const RoomBoard: React.FC<RoomBoardProps> = ({ rooms, beds, occupancies }) => {
  const { processedRooms } = useRoomBoard(rooms, beds, occupancies);

  return (
    <div className="w-full h-full overflow-y-auto bg-gray-50/50 p-2 sm:p-4 rounded-3xl">
      <div className="flex items-center gap-3 mb-6 px-2">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-200">
          <BedDouble size={20} strokeWidth={3} />
        </div>
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight">Sổ Phòng</h2>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-0.5">Giám sát trạng thái phòng thực tế</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6 pb-20">
        {processedRooms.map(room => (
          <div key={room.id} className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            {/* Room Header */}
            <div className={`px-5 py-4 border-b ${
              room.status === 'EMPTY' ? 'bg-emerald-50/50 border-emerald-100' : 
              room.status === 'FULL' ? 'bg-rose-50/50 border-rose-100' : 
              'bg-amber-50/50 border-amber-100'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-black text-gray-900">{room.name}</span>
                  <span className="text-[10px] font-black text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                    {room.type}
                  </span>
                </div>
                <div className="text-xs font-black px-2.5 py-1 rounded-full bg-white border shadow-sm flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    room.status === 'EMPTY' ? 'bg-emerald-500' : 
                    room.status === 'FULL' ? 'bg-rose-500' : 
                    'bg-amber-500'
                  }`} />
                  <span className={
                    room.status === 'EMPTY' ? 'text-emerald-700' : 
                    room.status === 'FULL' ? 'text-rose-700' : 
                    'text-amber-700'
                  }>
                    {room.occupiedBeds}/{room.totalBeds} Giường
                  </span>
                </div>
              </div>
            </div>

            {/* Beds List */}
            <div className="p-4 flex-1 flex flex-col gap-3">
              {room.beds.map(bed => {
                const isBusy = bed.occupancy && (bed.occupancy.status === 'IN_PROGRESS' || bed.occupancy.status === 'PREPARING');
                const isCleaning = bed.occupancy && bed.occupancy.status === 'CLEANING';
                const isEmpty = !bed.occupancy || bed.occupancy.status === 'COMPLETED';

                return (
                  <div 
                    key={bed.id} 
                    className={`relative p-3 rounded-2xl border transition-all ${
                      isBusy ? 'bg-rose-50/30 border-rose-100' : 
                      isCleaning ? 'bg-amber-50/30 border-amber-100' : 
                      'bg-gray-50 border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-black text-gray-700 flex items-center gap-2">
                        <BedDouble size={14} className={
                          isBusy ? 'text-rose-400' : 
                          isCleaning ? 'text-amber-400' : 
                          'text-emerald-400'
                        } />
                        {bed.name}
                      </span>
                      
                      {isEmpty && (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 size={10} /> Trống
                        </span>
                      )}
                      {isCleaning && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Sparkles size={10} /> Đang dọn
                        </span>
                      )}
                      {isBusy && (
                        <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                          <Clock size={10} /> Đang làm
                        </span>
                      )}
                    </div>

                    {(isBusy || isCleaning) && bed.occupancy && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200/50">
                        <div className="flex flex-col gap-1">
                          {bed.occupancy.ktvName && (
                            <span className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
                              <User size={12} className="text-indigo-400" />
                              {bed.occupancy.ktvName}
                            </span>
                          )}
                          <span className="text-[10px] font-bold text-gray-400 truncate max-w-[120px]" title={bed.occupancy.serviceName}>
                            {bed.occupancy.serviceName}
                          </span>
                        </div>
                        
                        {bed.occupancy.endTime && (
                          <div className="text-right">
                            <span className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Xong lúc</span>
                            <span className={`text-sm font-black ${isCleaning ? 'text-amber-600' : 'text-rose-600'}`}>
                              {bed.occupancy.endTime}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {room.beds.length === 0 && (
                <div className="py-6 text-center text-gray-400 text-sm font-medium">
                  Phòng chưa có giường
                </div>
              )}
            </div>
          </div>
        ))}

        {processedRooms.length === 0 && (
          <div className="col-span-full py-12 text-center text-gray-400">
            Không có dữ liệu phòng
          </div>
        )}
      </div>
    </div>
  );
};
