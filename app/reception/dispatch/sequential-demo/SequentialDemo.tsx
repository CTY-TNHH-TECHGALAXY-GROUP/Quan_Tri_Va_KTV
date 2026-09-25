'use client';

import { useEffect, useState } from 'react';
import { KanbanBoard } from '../_components/KanbanBoard';
import { QuickDispatchTable } from '../_components/QuickDispatchTable';
import { sequentialSlotsComplete } from '@/lib/dispatch-status';
import type { PendingOrder, ServiceBlock, StaffData, TurnQueueData, WorkSegment } from '../types';

const storageKey = 'dispatch-sequential-demo-v1';
const staff: StaffData[] = [
  { id: 'DEMO-A', full_name: 'KTV A', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-B', full_name: 'KTV B', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-C', full_name: 'KTV C', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
];
type DemoSegment = WorkSegment & { ktvId: string; sequenceSlot: number; voided?: boolean; plannedEndAt?: string };
type HandoffForm = { ktvId: string; start: string; duration: number };
const localInput = (date: Date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date).replace(' ', 'T');
const segmentOf = (row: ServiceBlock['staffList'][number]) => row.segments[0] as DemoSegment;

function sampleOrder(): PendingOrder {
  const start = new Date(Date.now() - 10 * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  const segment: DemoSegment = {
    id: 'demo-a', ktvId: 'DEMO-A', sequenceSlot: 1, roomId: 'R01', bedId: 'BED01',
    startTime: localInput(start).slice(11), endTime: localInput(end).slice(11),
    duration: 60, actualStartTime: start.toISOString(), plannedEndAt: end.toISOString(),
  };
  return {
    id: 'DEMO-BOOKING', billCode: 'LOCAL-DEMO-001', customerName: 'Khách thử nghiệm', phone: '',
    time: segment.startTime, dispatchStatus: 'IN_PROGRESS', rawStatus: 'IN_PROGRESS',
    createdAt: start.toISOString(), updatedAt: new Date().toISOString(), paymentMethod: 'Cash',
    rating: 4, guestCount: 1, hasAssignedKtv: true,
    services: [{
      id: 'DEMO-ITEM', serviceId: 'NHS0001', serviceName: 'Dịch vụ nối tiếp mẫu',
      duration: 60, price: 0, quantity: 1, selectedRoomId: 'R01', bedId: 'BED01',
      status: 'IN_PROGRESS', options: { sequentialSlots: 2 },
      staffList: [{ id: 'demo-row-a', ktvId: 'DEMO-A', ktvName: 'KTV A', segments: [segment], noteForKtv: '' }],
      adminNote: '', genderReq: '', strength: '', focus: '', avoid: '', customerNote: '',
    }],
  };
}

export default function SequentialDemo() {
  const [order, setOrder] = useState<PendingOrder | null>(null);
  const [ready, setReady] = useState(false);
  const [handoff, setHandoff] = useState<HandoffForm | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      setOrder(saved?.services?.[0]?.staffList ? saved : sampleOrder());
    } catch { setOrder(sampleOrder()); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready && order) localStorage.setItem(storageKey, JSON.stringify(order)); }, [ready, order]);

  const change = (edit: (service: ServiceBlock) => void) => setOrder(previous => {
    if (!previous) return previous;
    const next = structuredClone(previous);
    edit(next.services[0]);
    next.dispatchStatus = (next.services[0].status || 'IN_PROGRESS') as PendingOrder['dispatchStatus'];
    next.updatedAt = new Date().toISOString();
    return next;
  });
  const service = order?.services[0];
  const a = service?.staffList.find(row => segmentOf(row).sequenceSlot === 1);
  const b = service?.staffList.find(row => segmentOf(row).sequenceSlot === 2 && segmentOf(row).voided !== true);
  const turns: (TurnQueueData & { staff?: StaffData })[] = staff.map((person, index) => ({
    employee_id: person.id, date: localInput(new Date()).slice(0, 10), queue_position: index + 1,
    check_in_order: index + 1, turns_completed: 0, status: person.id === 'DEMO-A' ? 'working'
      : person.id === b?.ktvId ? 'assigned' : 'waiting', staff: person, checked_in_today: true,
  }));

  const openHandoff = (_itemId: string, _fromKtvId: string, toKtvId: string) => {
    const current = b && segmentOf(b);
    setHandoff({ ktvId: toKtvId || b?.ktvId || '',
      start: current?.startTime && current.plannedEndAt
        ? localInput(new Date(new Date(current.plannedEndAt).getTime() - current.duration * 60_000))
        : localInput(new Date((a && segmentOf(a).plannedEndAt) || Date.now())),
      duration: current?.duration || 20 });
  };
  const saveHandoff = () => {
    if (!handoff || !a || !service) return;
    if (service.options?.finishedAfterA || (b && segmentOf(b).actualStartTime)) {
      alert('Lượt B đã bắt đầu hoặc ca đã kết thúc sau A.'); return;
    }
    const startMs = Date.parse(`${handoff.start}${handoff.start.length === 16 ? ':00' : ''}+07:00`);
    if (!handoff.ktvId || handoff.ktvId === a.ktvId || !Number.isFinite(startMs)
      || !Number.isInteger(handoff.duration) || handoff.duration < 1 || handoff.duration > 600) {
      alert('Chọn KTV B khác A, giờ bắt đầu và thời lượng 1–600 phút.'); return;
    }
    const reference = Date.parse(segmentOf(a).actualEndTime || segmentOf(a).plannedEndAt || '');
    if (startMs < reference && !confirm(`B bắt đầu trước khi A kết thúc ${segmentOf(a).actualEndTime ? 'thực tế' : 'dự kiến'}. Vẫn gán B?`)) return;
    change(s => {
      const old = s.staffList.find(row => segmentOf(row).sequenceSlot === 2 && segmentOf(row).voided !== true);
      const end = new Date(startMs + handoff.duration * 60_000);
      const segment: DemoSegment = {
        id: old?.ktvId === handoff.ktvId ? segmentOf(old).id : `demo-b-${Date.now()}`,
        ktvId: handoff.ktvId, sequenceSlot: 2, roomId: segmentOf(a).roomId, bedId: segmentOf(a).bedId,
        startTime: handoff.start.slice(11, 16), endTime: localInput(end).slice(11),
        duration: handoff.duration, plannedEndAt: end.toISOString(),
      };
      if (old?.ktvId === handoff.ktvId) old.segments = [segment];
      else {
        if (old) segmentOf(old).voided = true;
        s.staffList.push({ id: `demo-row-${handoff.ktvId}`, ktvId: handoff.ktvId,
          ktvName: staff.find(person => person.id === handoff.ktvId)?.full_name || handoff.ktvId,
          segments: [segment], noteForKtv: '' });
      }
    });
    setHandoff(null);
  };
  const stamp = (slot: number, field: 'actualStartTime' | 'actualEndTime') => change(s => {
    const row = s.staffList.find(person => segmentOf(person).sequenceSlot === slot && segmentOf(person).voided !== true);
    if (!row) return;
    const segment = segmentOf(row);
    if (field === 'actualEndTime' && !segment.actualStartTime) return;
    segment[field] ||= new Date().toISOString();
    if (sequentialSlotsComplete(s.options, s.staffList.map(segmentOf))) s.status = 'CLEANING';
  });
  const finishAfterA = () => {
    if (!a || !segmentOf(a).actualEndTime || (b && segmentOf(b).actualStartTime)) {
      alert('A phải hoàn tất và B chưa bắt đầu.'); return;
    }
    change(s => {
      const currentB = s.staffList.find(row => segmentOf(row).sequenceSlot === 2 && segmentOf(row).voided !== true);
      if (currentB) segmentOf(currentB).voided = true;
      s.options = { ...s.options, finishedAfterA: true };
      s.status = 'CLEANING';
    });
  };

  if (!order || !service) return <p className="p-6">Đang tạo dữ liệu mẫu…</p>;
  return <main className="mx-auto max-w-7xl space-y-6 p-6 text-slate-800">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h1 className="text-xl font-bold">Demo nối tiếp A/B · chỉ trên trình duyệt</h1>
      <p className="text-sm">Dữ liệu lưu tại <code>localStorage[{storageKey}]</code>. Các nút mẫu bên dưới không gọi RPC hay ghi DB.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button className="rounded bg-indigo-600 px-3 py-2 text-white" onClick={() => openHandoff(service.id, a?.ktvId || '', b?.ktvId || '')}>Gán / sửa B</button>
      <button className="rounded bg-sky-600 px-3 py-2 text-white" onClick={() => stamp(1, 'actualEndTime')}>A hoàn tất</button>
      <button className="rounded bg-sky-600 px-3 py-2 text-white" onClick={() => stamp(2, 'actualStartTime')}>B bắt đầu</button>
      <button className="rounded bg-sky-600 px-3 py-2 text-white" onClick={() => stamp(2, 'actualEndTime')}>B hoàn tất</button>
      <button className="rounded bg-amber-600 px-3 py-2 text-white" onClick={finishAfterA}>Kết thúc sau A</button>
      <button className="rounded border px-3 py-2" onClick={() => { localStorage.removeItem(storageKey); setOrder(sampleOrder()); }}>Tạo lại mẫu</button>
    </div>
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">Kanban thật với dữ liệu mẫu</h2>
      <div className="h-[560px]"><KanbanBoard orders={[order]} staffs={staff} selectedOrderId={order.id}
        onUpdateStatus={(_id, status) => {
          if (['CLEANING', 'FEEDBACK', 'DONE'].includes(status)
            && !sequentialSlotsComplete(service.options, service.staffList.map(segmentOf))) {
            alert('Còn lượt B chưa hoàn tất.'); return;
          }
          change(s => { s.status = status; });
        }}
        onOpenDetail={() => document.getElementById('demo-quick')?.scrollIntoView({ behavior: 'smooth' })}
        onAssignSequentialB={(_orderId, itemId, fromKtvId, toKtvId) => openHandoff(itemId, fromKtvId, toKtvId || '')}
        onFinishSequentialAfterA={finishAfterA} />
      </div>
    </section>
    <section id="demo-quick" className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">Điều phối nhanh thật với dữ liệu mẫu</h2>
      <QuickDispatchTable services={[service]} orderId={order.id} rooms={[{ id: 'R01', name: 'Phòng 01', type: 'standard' }]}
        beds={[{ id: 'BED01', roomId: 'R01' }]} availableTurns={turns} staffs={staff} busyBedIds={[]}
        billCode={order.billCode} onUpdateServices={updated => change(s => Object.assign(s, updated[0]))}
        onPrintGroup={() => alert('Demo local: không in phiếu.')} onDispatchGroup={() => alert('Demo local: không gửi đơn.')}
        onLiveHandoff={openHandoff} onEnableSequential={() => change(s => {
          s.options = { ...s.options, sequentialSlots: 2 }; segmentOf(s.staffList[0]).sequenceSlot = 1;
        })} />
    </section>
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Xem JSON đang lưu</summary>
      <pre className="overflow-auto text-xs">{JSON.stringify(order, null, 2)}</pre></details>
    {handoff && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Gán lượt B demo">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5">
        <h2 className="font-bold">Gán / sửa lượt B</h2>
        <label className="block">KTV B<select className="mt-1 w-full rounded border p-2" value={handoff.ktvId}
          onChange={event => setHandoff({ ...handoff, ktvId: event.target.value })}>
          <option value="">Chọn KTV</option>{staff.filter(person => person.id !== a?.ktvId).map(person =>
            <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>
        <label className="block">B bắt đầu dự kiến<input type="datetime-local" className="mt-1 w-full rounded border p-2"
          value={handoff.start} onChange={event => setHandoff({ ...handoff, start: event.target.value })} /></label>
        <label className="block">Phút B<input type="number" min="1" max="600" className="mt-1 w-full rounded border p-2"
          value={handoff.duration} onChange={event => setHandoff({ ...handoff, duration: Number(event.target.value) })} /></label>
        <div className="flex justify-end gap-2"><button onClick={() => setHandoff(null)}>Hủy</button>
          <button className="rounded bg-indigo-600 px-3 py-2 text-white" onClick={saveHandoff}>Lưu B</button></div>
      </div>
    </div>}
  </main>;
}
