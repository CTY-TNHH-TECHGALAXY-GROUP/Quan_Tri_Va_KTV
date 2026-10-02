'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ScreenDashboard } from '../_screens/ScreenDashboard';
import { Clock, RefreshCw, Sparkles, CheckCircle2, Sliders } from 'lucide-react';

export default function KTVDashboardDemoPage() {
  const [startTime, setStartTime] = useState('18:30');
  const [room, setRoom] = useState('VIP 2');
  const [bed, setBed] = useState('G-02');
  const [billCode, setBillCode] = useState('088-02102026-A');
  const [serviceName, setServiceName] = useState('Massage Body Trị Liệu Cổ Vai Gáy (60p)');
  const [isTakeover, setIsTakeover] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Tạo mock logic cho ScreenDashboard
  const mockBooking = {
    id: 'DEMO-BOOKING-001',
    billCode: billCode,
    timeStart: startTime,
    dispatchStartTime: startTime,
    assignedRoomId: room,
    assignedBedId: bed,
    roomName: room,
    acceptedAt: accepted ? '2026-10-02T11:00:00Z' : null,
    BookingItems: [
      {
        id: 'demo-item-1',
        service_name: serviceName,
        duration: 60,
        timeStart: startTime,
        status: 'PENDING',
        segments: [
          {
            id: 'seg-demo-1',
            ktvId: 'T021',
            startTime: startTime,
            duration: 60,
            roomId: room,
            bedId: bed,
            note: isTakeover ? 'TAKEOVER' : undefined,
          },
        ],
      },
    ],
  };

  const mockLogic: any = {
    ktvId: 'T021',
    user: { id: 'T021', name: 'KTV T021' },
    showNoti: false,
    setShowNoti: () => {},
    unreadCount: 0,
    notifications: [],
    canViewWallet: true,
    walletAnyOn: true,
    disciplineStatus: {
      minHoursToReject: 3,
      rejectMultiplier: 3,
      continuousWorkMins: 120,
      exemptHours: 5,
    },
    workType: 'TYPE_D',
    activeSegmentIndex: 0,
    booking: mockBooking,
    checklist: [],
    isChecklistComplete: false,
    handleConfirmSetup: () => {},
    setShowProcedure: () => {},
    prepProcedure: null,
    toggleChecklist: () => {},
    checkAllChecklist: () => {},
    setShowRoomIssueModal: () => {},
    walletBalance: 2500000,
    walletTimeline: [],
    onCallState: null,
    handleToggleOnCall: () => {},
    handleArriveAtVenue: () => {},
    kpiData: null,
    pendingHandovers: [],
    turnData: null,
    forceRefresh: async () => {
      setAccepted(true);
    },
    goToDashboard: () => {},
  };

  return (
    <AppLayout title="Demo Thẻ Nhận / Từ Chối Đơn KTV">
      <div className="max-w-5xl mx-auto p-4 space-y-6">
        {/* Banner hướng dẫn kiểm tra */}
        <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-5 rounded-3xl shadow-lg border border-indigo-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="text-amber-400" size={20} />
                <h2 className="text-lg font-black tracking-tight">DEMO KIỂM TRA THẺ XÁC NHẬN / TỪ CHỐI ĐƠN STAFF</h2>
              </div>
              <p className="text-xs text-indigo-200">
                Thẻ bên dưới hiển thị đúng giao diện thực tế của KTV khi nhận được đơn điều phối, với thông tin <b>Giờ bắt đầu</b> mới được bổ sung.
              </p>
            </div>

            <button
              onClick={() => {
                setAccepted(false);
                setStartTime('18:30');
                setRoom('VIP 2');
                setBed('G-02');
                setIsTakeover(false);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-bold transition-all flex items-center gap-2 self-start sm:self-auto shrink-0"
            >
              <RefreshCw size={14} />
              <span>Reset Thẻ</span>
            </button>
          </div>

          {/* Controls tuỳ chỉnh nhanh */}
          <div className="mt-4 pt-4 border-t border-indigo-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-indigo-300 mb-1">Giờ bắt đầu:</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-indigo-950 border border-indigo-700 rounded-lg px-2.5 py-1.5 text-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-indigo-300 mb-1">Phòng:</label>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                className="w-full bg-indigo-950 border border-indigo-700 rounded-lg px-2.5 py-1.5 text-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-indigo-300 mb-1">Giường:</label>
              <input
                type="text"
                value={bed}
                onChange={(e) => setBed(e.target.value)}
                className="w-full bg-indigo-950 border border-indigo-700 rounded-lg px-2.5 py-1.5 text-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer bg-indigo-950 border border-indigo-700 rounded-lg px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={isTakeover}
                  onChange={(e) => setIsTakeover(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span className="text-[11px] font-bold text-indigo-200">Đơn vào thay</span>
              </label>
            </div>
          </div>
        </div>

        {/* Trạng thái đã bấm nhận đơn */}
        {accepted && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-emerald-800 text-sm font-bold animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="text-emerald-600" size={20} />
              <span>KTV đã bấm &quot;NHẬN ĐƠN&quot; thành công! Đơn chuyển sang giai đoạn chuẩn bị phòng & đồng hồ.</span>
            </div>
            <button
              onClick={() => setAccepted(false)}
              className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold"
            >
              Xem lại thẻ chờ
            </button>
          </div>
        )}

        {/* Màn hình KTV Dashboard thực tế */}
        <div className="border border-slate-200 rounded-3xl bg-slate-50/50 p-2 sm:p-4 shadow-inner">
          <ScreenDashboard logic={mockLogic} />
        </div>
      </div>
    </AppLayout>
  );
}
