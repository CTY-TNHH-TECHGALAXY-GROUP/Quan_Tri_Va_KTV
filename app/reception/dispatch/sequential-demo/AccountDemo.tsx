'use client';

import { ktvServiceName } from '@/lib/ktvUtils';
import { demoAccountState } from './demo-account';
import { WorkingTimeline } from '@/app/ktv/dashboard/_screens/ScreenTimer';
import { gioDongHoVN } from '@/lib/segment-time';
import type { ServiceBlock } from '../types';

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function AccountDemo({ service, employeeId, employeeName, now, onStamp }: {
  service: ServiceBlock; employeeId: string; employeeName: string; now: number;
  onStamp: (employeeId: string, field: 'actualStartTime' | 'actualEndTime') => void;
}) {
  const state = demoAccountState(service, employeeId, now);
  const segment = state.segment;
  return <section className="rounded-xl border bg-white p-5" aria-label={`Tài khoản ${employeeName}`}>
    <h2 className="text-lg font-bold">Tài khoản demo · {employeeName}</h2>
    <p className="mb-4 text-sm text-slate-500">Mã nhân viên: {employeeId}</p>
    {!state.assigned ? <p>Chưa có phân công gửi cho tài khoản này.</p> : <>
      <h3 className="font-bold">{ktvServiceName({ options: service.options, base_service_name: service.serviceName }, employeeId)}</h3>
      <p>Phòng {segment!.roomId} · Giường {segment!.bedId} · {segment!.duration} phút</p>
      <p>Giờ dự kiến của bạn: {segment!.startTime} → {segment!.endTime}</p>
      <div className="my-4"><WorkingTimeline segments={[segment!]} activeIndex={segment!.actualStartTime && !segment!.actualEndTime ? 0 : undefined} /></div>
      <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt>Bắt đầu thực tế</dt><dd className="font-bold">{segment!.actualStartTime ? gioDongHoVN(segment!.actualStartTime) : 'Chưa bắt đầu'}</dd></div>
        <div><dt>Kết thúc thực tế</dt><dd className="font-bold">{segment!.actualEndTime ? gioDongHoVN(segment!.actualEndTime) : 'Chưa kết thúc'}</dd></div>
        <div><dt>Đã làm</dt><dd className="font-mono text-2xl" aria-label="Đã làm">{clock(state.elapsedMs)}</dd></div>
        <div><dt>Còn lại</dt><dd className="font-mono text-2xl" aria-label="Còn lại">{clock(state.remainingMs)}</dd></div>
      </dl>
      <p className="mb-3 font-bold">{segment!.actualEndTime ? 'Bạn đã hoàn tất lượt làm.' : segment!.actualStartTime ? 'Bạn đang thực hiện dịch vụ.' : state.canStart ? 'Đã phân công · sẵn sàng bắt đầu.' : 'Ca đã đóng.'}</p>
      <div className="flex gap-2">
        <button disabled={!state.canStart} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => onStamp(employeeId, 'actualStartTime')}>Bắt đầu lượt của tôi</button>
        <button disabled={!state.canFinish} className="rounded bg-emerald-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => onStamp(employeeId, 'actualEndTime')}>Hoàn tất lượt của tôi</button>
      </div>
    </>}
  </section>;
}
