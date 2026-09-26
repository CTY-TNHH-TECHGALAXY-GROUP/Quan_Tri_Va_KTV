'use client';

import { useEffect, useState } from 'react';
import { KanbanBoard } from '../_components/KanbanBoard';
import { QuickDispatchTable } from '../_components/QuickDispatchTable';
import { isTwoSlotSequential, sequentialSlotsComplete } from '@/lib/dispatch-status';
import { remainingHandoffMinutes, plannedHandoffStartAt } from '@/lib/dispatch-handoff';
import type { PendingOrder, ServiceBlock, StaffData, TurnQueueData, WorkSegment } from '../types';

const storageKey = 'dispatch-sequential-demo-v2';
const staff: StaffData[] = [
  { id: 'DEMO-A', full_name: 'KTV A', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-B', full_name: 'KTV B', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-C', full_name: 'KTV C', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
];
type DemoSegment = WorkSegment & { ktvId: string; sequenceSlot?: number; voided?: boolean; plannedEndAt?: string };
type HandoffForm = { ktvId: string; start: string; duration: number };
const localInput = (date: Date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date).replace(' ', 'T');
const segmentOf = (row: ServiceBlock['staffList'][number]) => row.segments[0] as DemoSegment;
const segmentsOf = (service: ServiceBlock) => service.staffList.map(row => ({ ...segmentOf(row), ktvId: row.ktvId }));
const plannedEndAt = (segment: DemoSegment) => {
  const start = Date.parse(`${localInput(new Date()).slice(0, 10)}T${segment.startTime.slice(0, 5)}:00+07:00`);
  return new Date(start + segment.duration * 60_000).toISOString();
};

function sampleOrder(): PendingOrder {
  const now = new Date();
  return {
    id: 'DEMO-BOOKING', billCode: 'LOCAL-DEMO-001', customerName: 'Khách thử nghiệm', phone: '',
    time: localInput(now).slice(11), dispatchStatus: 'pending', rawStatus: 'NEW',
    createdAt: now.toISOString(), updatedAt: now.toISOString(), paymentMethod: 'Cash',
    rating: null, guestCount: 1, hasAssignedKtv: false,
    services: [{
      id: 'DEMO-ITEM', serviceId: 'NHS0001', serviceName: 'Dịch vụ mẫu 60 phút',
      duration: 60, price: 0, quantity: 1, selectedRoomId: null, bedId: null,
      status: 'NEW', options: {}, staffList: [],
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
      saved?.services?.[0]?.staffList?.forEach((row: ServiceBlock['staffList'][number]) =>
        row.segments.forEach(segment => { (segment as DemoSegment).ktvId = row.ktvId; }));
      setOrder(saved?.services?.[0]?.staffList ? saved : sampleOrder());
    } catch { setOrder(sampleOrder()); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready && order) localStorage.setItem(storageKey, JSON.stringify(order)); }, [ready, order]);

  const change = (edit: (service: ServiceBlock) => void) => setOrder(previous => {
    if (!previous) return previous;
    const next = structuredClone(previous);
    edit(next.services[0]);
    const status = next.services[0].status || 'NEW';
    next.dispatchStatus = status === 'NEW' ? 'pending' : status as PendingOrder['dispatchStatus'];
    next.rawStatus = status;
    next.rating = Number(next.services[0].itemRating) || null;
    next.hasAssignedKtv = status !== 'NEW' && next.services[0].staffList.length > 0;
    next.updatedAt = new Date().toISOString();
    return next;
  });
  const service = order?.services[0];
  const a = service?.staffList.find(row => segmentOf(row).sequenceSlot === 1) || service?.staffList[0];
  const b = service?.staffList.find(row => segmentOf(row).sequenceSlot === 2 && segmentOf(row).voided !== true);
  const isSequential = isTwoSlotSequential(service?.options);
  const turns: (TurnQueueData & { staff?: StaffData })[] = staff.map((person, index) => ({
    employee_id: person.id, date: localInput(new Date()).slice(0, 10), queue_position: index + 1,
    check_in_order: index + 1, turns_completed: 0, status: service?.status === 'NEW' ? 'waiting'
      : person.id === a?.ktvId ? (segmentOf(a).actualStartTime && !segmentOf(a).actualEndTime ? 'working' : 'assigned')
      : person.id === b?.ktvId ? (segmentOf(b).actualStartTime && !segmentOf(b).actualEndTime ? 'working' : 'assigned') : 'waiting', staff: person, checked_in_today: true,
  }));
  const dispatchA = () => {
    if (!service || !a || service.status !== 'NEW' || (!isSequential && service.staffList.length !== 1)) {
      alert('Chọn KTV A trước khi gửi phân công.'); return;
    }
    if (service.staffList.some(row => {
      const segment = segmentOf(row);
      return !segment.roomId || !segment.bedId || !segment.startTime || !Number.isInteger(segment.duration) || segment.duration < 1 || segment.duration > 600;
    })) {
      alert('Chọn phòng, giường, giờ và thời lượng 1–600 phút cho từng nhân viên.'); return;
    }
    change(s => {
      s.staffList.forEach(row => {
        const segment = segmentOf(row);
        segment.ktvId = row.ktvId;
        segment.plannedEndAt = plannedEndAt(segment);
      });
      const current = segmentOf(s.staffList[0]);
      s.selectedRoomId = current.roomId;
      s.bedId = current.bedId;
      s.status = 'PREPARING';
    });
  };

  const openHandoff = (_itemId: string, _fromKtvId: string, toKtvId: string) => {
    if (!service || !isTwoSlotSequential(service.options) || !['PREPARING', 'IN_PROGRESS'].includes(service.status || '')) {
      alert('Gửi phân công A ở chế độ nối tiếp trước khi gán B.'); return;
    }
    const current = b && segmentOf(b);
    setHandoff({ ktvId: toKtvId || b?.ktvId || '',
      start: current?.startTime && current.plannedEndAt
        ? localInput(new Date(new Date(current.plannedEndAt).getTime() - current.duration * 60_000))
        : localInput(new Date((a && plannedHandoffStartAt(localInput(new Date()).slice(0, 10), segmentOf(a))) || Date.now())),
      duration: current?.duration ?? remainingHandoffMinutes(service.duration, a ? segmentOf(a).duration : 0) });
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
    if (!['PREPARING', 'IN_PROGRESS'].includes(s.status || '')) return;
    const row = slot === 1 && !isTwoSlotSequential(s.options) ? s.staffList[0]
      : s.staffList.find(person => segmentOf(person).sequenceSlot === slot && segmentOf(person).voided !== true);
    if (!row) return;
    const segment = segmentOf(row);
    if (field === 'actualEndTime' && !segment.actualStartTime) return;
    segment[field] ||= new Date().toISOString();
    if (field === 'actualStartTime') s.status = 'IN_PROGRESS';
    if (field === 'actualEndTime' && (isTwoSlotSequential(s.options)
      ? sequentialSlotsComplete(s.options, segmentsOf(s))
      : !!segment.actualEndTime)) s.status = 'CLEANING';
  });
  const finishAfterA = () => {
    if (!service || !isTwoSlotSequential(service.options) || !a || !segmentOf(a).actualEndTime || (b && segmentOf(b).actualStartTime)) {
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
  const aSegment = a && segmentOf(a);
  const bSegment = b && segmentOf(b);
  const finished = isSequential
    ? sequentialSlotsComplete(service.options, segmentsOf(service))
    : !!aSegment?.actualEndTime;
  const canWork = ['PREPARING', 'IN_PROGRESS'].includes(service.status || '');
  return <main className="mx-auto max-w-7xl space-y-6 p-6 text-slate-800">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h1 className="text-xl font-bold">Test trọn quy trình điều phối · chỉ trên trình duyệt</h1>
      <p className="text-sm">Chọn A rồi gửi phân công. Khi cần người làm tiếp, bấm + Nối tiếp dưới A; chọn B ngay hoặc để trống chọn sau. Dữ liệu lưu tại <code>localStorage[{storageKey}]</code>; không ghi DB.</p>
    </div>
    <section id="demo-quick" className="rounded-xl border bg-white p-4">
      <h2 className="mb-1 font-bold">1. Chọn KTV A, phòng, giường và giờ dự kiến</h2>
      <p className="mb-3 text-sm text-slate-500">Dùng bảng điều phối thật bên dưới. A chưa đủ phút của gói thì bảng gợi ý thêm người nối tiếp.</p>
      <QuickDispatchTable key={order.createdAt} services={[service]} orderId={order.id} rooms={[{ id: 'R01', name: 'Phòng 01', type: 'standard' }]}
        beds={[{ id: 'BED01', roomId: 'R01' }]} availableTurns={turns} staffs={staff} busyBedIds={[]}
        billCode={order.billCode} onUpdateServices={updated => change(s => {
          const before = s.staffList;
          const status = s.status;
          Object.assign(s, updated[0]);
          s.status = status;
          s.staffList.forEach(row => {
            segmentOf(row).ktvId = row.ktvId;
            const previous = before.find(old => old.ktvId === row.ktvId);
            if (previous) {
              segmentOf(row).actualStartTime = segmentOf(previous).actualStartTime;
              segmentOf(row).actualEndTime = segmentOf(previous).actualEndTime;
              (segmentOf(row) as DemoSegment).plannedEndAt = status === 'PREPARING' && !segmentOf(previous).actualStartTime
                ? plannedEndAt(segmentOf(row)) : segmentOf(previous).plannedEndAt;
            }
          });
        })}
        onPrintGroup={() => alert('Demo local: không in phiếu.')} onDispatchGroup={dispatchA}
        onLiveHandoff={openHandoff} onEnableSequential={() => change(s => {
          s.options = { ...s.options, sequentialSlots: 2 };
          segmentOf(s.staffList[0]).sequenceSlot = 1;
        })} />
    </section>
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">2. Gửi phân công</h2>
      <div className="flex flex-wrap gap-2">
        <button disabled={!a || service.status !== 'NEW'} className="rounded bg-indigo-600 px-3 py-2 font-bold text-white disabled:opacity-40"
          onClick={dispatchA}>{isSequential && b ? 'Gửi phân công A + B' : 'Gửi phân công A'}</button>
        <button className="rounded border px-3 py-2" onClick={() => { localStorage.removeItem(storageKey); setHandoff(null); setOrder(sampleOrder()); }}>Tạo dịch vụ mới</button>
      </div>
      <p className="mt-2 text-sm">Trạng thái: <strong>{service.status}</strong> · A: <strong>{a?.ktvName || 'chưa chọn'}</strong>{isSequential && <> · B: <strong>{b?.ktvName || 'chọn sau'}</strong></>}</p>
    </section>
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">3. Thực hiện và kết thúc ca</h2>
      <div className="flex flex-wrap gap-2">
        <button disabled={!canWork || !!aSegment?.actualStartTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(1, 'actualStartTime')}>A bắt đầu</button>
        <button disabled={!aSegment?.actualStartTime || !!aSegment.actualEndTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(1, 'actualEndTime')}>A hoàn tất</button>
        {isSequential && <>
          <button disabled={!canWork || !!bSegment?.actualStartTime || !!service.options?.finishedAfterA} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-40"
            onClick={() => openHandoff(service.id, a?.ktvId || '', b?.ktvId || '')}>Gán / sửa B</button>
          <button disabled={!canWork || !bSegment || !!bSegment.actualStartTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(2, 'actualStartTime')}>B bắt đầu</button>
          <button disabled={!bSegment?.actualStartTime || !!bSegment.actualEndTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(2, 'actualEndTime')}>B hoàn tất</button>
          <button disabled={!aSegment?.actualEndTime || !!bSegment?.actualStartTime || !!service.options?.finishedAfterA} className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-40" onClick={finishAfterA}>Kết thúc sau A</button>
        </>}
      </div>
    </section>
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">4. Theo dõi trên Kanban</h2>
      <div className="h-[560px]"><KanbanBoard orders={[order]} staffs={staff} selectedOrderId={order.id}
        onUpdateStatus={(_id, status) => {
          if (status === 'IN_PROGRESS' && service.status === 'PREPARING') { stamp(1, 'actualStartTime'); return; }
          if (['CLEANING', 'FEEDBACK', 'DONE'].includes(status) && !finished) {
            alert('Ca chưa hoàn tất.'); return;
          }
          change(s => {
            s.status = status;
            if (['FEEDBACK', 'DONE'].includes(status)) s.staffList.forEach(row => {
              if (segmentOf(row).voided !== true) segmentOf(row).feedbackTime ||= new Date().toISOString();
            });
          });
        }}
        onOpenDetail={() => document.getElementById('demo-quick')?.scrollIntoView({ behavior: 'smooth' })}
        onAssignSequentialB={(_orderId, itemId, fromKtvId, toKtvId) => openHandoff(itemId, fromKtvId, toKtvId || '')}
        onFinishSequentialAfterA={finishAfterA}
        onCustomerRating={(_id, rating) => change(s => { s.itemRating = rating; })}
        onKtvCommentClick={() => { const note = prompt('Nhận xét mẫu (lưu localStorage):'); if (note !== null) change(s => { s.handover_comment = note; }); }}
        onOpenRatingLink={() => alert('Demo local: dùng các nút sao trên Kanban để đánh giá mẫu.')} />
      </div>
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
