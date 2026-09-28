'use client';
import { ktvMetadataValue, parseKtvOptions } from '@/lib/ktvUtils';

import { useEffect, useState } from 'react';
import { KanbanBoard } from '../_components/KanbanBoard';
import { QuickDispatchTable } from '../_components/QuickDispatchTable';
import { isTwoSlotSequential, sequentialSlotsComplete } from '@/lib/dispatch-status';
import { remainingHandoffMinutes, plannedHandoffStartAt, suggestedHandoffMinutes } from '@/lib/dispatch-handoff';
import type { PendingOrder, ServiceBlock, StaffData, TurnQueueData } from '../types';
import { AccountDemo } from './AccountDemo';
import { liveDispatchConflict } from '@/lib/dispatch-live-guard';
import { dispatchRevision, recordDispatchEdit } from '@/lib/dispatch-edit-history';
import { DispatchEditHistory } from '../_components/DispatchEditHistory';
import { segmentOf, segmentsOf, stampDemoAccount, type DemoSegment } from './demo-account';
import SequentialLifecycleModal from '../_components/SequentialLifecycleModal';
import { applySequentialLifecycle, type SequentialRequest } from '@/lib/sequential-lifecycle';

const storageKey = 'dispatch-sequential-demo-v2';
const staff: StaffData[] = [
  { id: 'DEMO-A', full_name: 'KTV A', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-B', full_name: 'KTV B', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
  { id: 'DEMO-C', full_name: 'KTV C', status: 'ĐANG LÀM', work_type: 'TYPE_A' },
];
type HandoffForm = { ktvId: string; start: string; duration: number; expectedRevision: number };
const localInput = (date: Date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date).replace(' ', 'T');
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
  const [accountId, setAccountId] = useState('');
  const [now, setNow] = useState(Date.now());
  const [handoff, setHandoff] = useState<HandoffForm | null>(null);
  const [lifecycleModal, setLifecycleModal] = useState<{ service: ServiceBlock; action: 'FINISH' | 'CANCEL' | 'SWAP' } | null>(null);

  const readOrder = (): PendingOrder | null => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved?.services?.[0]?.staffList) return null;
      // Repair demo snapshots made before returning employees reused their row.
      for (const service of saved.services) {
        const rows = new Map<string, ServiceBlock['staffList'][number]>();
        for (const row of service.staffList) {
          const previous = rows.get(row.ktvId);
          rows.set(row.ktvId, previous ? { ...previous, ...row, segments: [...row.segments, ...previous.segments] } : row);
        }
        service.staffList = [...rows.values()];
      }
      return saved;
    } catch { return null; }
  };
  const saveOrder = (next: PendingOrder) => {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setOrder(next);
  };
  useEffect(() => {
    const saved = readOrder();
    if (saved) setOrder(saved);
    else saveOrder(sampleOrder());
    setAccountId(new URLSearchParams(window.location.search).get('account') || '');
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setOrder(readOrder() || sampleOrder());
    };
    window.addEventListener('storage', sync);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener('storage', sync); window.clearInterval(tick); };
  }, []);

  const change = (edit: (service: ServiceBlock) => void | string, action = 'DRAFT', expectedRevision?: number) => {
    const previous = readOrder() || order;
    if (!previous) return false;
    if (expectedRevision !== undefined && expectedRevision !== dispatchRevision(previous.services[0].options)) {
      alert('Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.');
      setOrder(previous); return false;
    }
    const next = structuredClone(previous);
    const error = edit(next.services[0]);
    if (error) { alert(error); setOrder(previous); return false; }
    if (!action.startsWith('LIFECYCLE_')) recordDispatchEdit(previous.services[0], next.services[0], action, { id: accountId || 'DEMO-ADMIN', name: accountId || 'Quầy demo' });
    const status = next.services[0].status || 'NEW';
    next.dispatchStatus = status === 'NEW' ? 'pending' : status as PendingOrder['dispatchStatus'];
    next.rawStatus = status;
    next.rating = Number(next.services[0].itemRating) || null;
    next.hasAssignedKtv = status !== 'NEW' && next.services[0].staffList.length > 0;
    next.updatedAt = new Date().toISOString();
    saveOrder(next);
    return true;
  };
  const service = order?.services[0];
  const a = service?.staffList.find(row => segmentOf(row).sequenceSlot === 1) || service?.staffList[0];
  const b = service?.staffList.find(row => segmentOf(row).sequenceSlot === 2 && segmentOf(row).voided !== true);
  const isSequential = isTwoSlotSequential(service?.options);
  const runLifecycle = (request: SequentialRequest, expectedRevision = dispatchRevision(service?.options)) => change(s => {
    try {
      const patch = applySequentialLifecycle({ ...s, segments: segmentsOf(s) }, request, undefined,
        { id: accountId || 'DEMO-ADMIN', name: accountId || 'Quầy demo' });
      const oldRows = s.staffList;
      const ids = [...new Set(patch.segments.map(seg => seg.ktvId))];
      const { segments: updatedSegments, ...fields } = patch;
      Object.assign(s, fields);
      delete (s as any).segments;
      s.staffList = ids.map(id => {
        const old = oldRows.find(row => row.ktvId === id);
        return { id: old?.id || `row-${id}`, ktvId: id, ktvName: old?.ktvName || staff.find(person => person.id === id)?.full_name || id,
          noteForKtv: old?.noteForKtv || '', serviceNameForKtv: old?.serviceNameForKtv || '',
          segments: updatedSegments.filter(seg => seg.ktvId === id) };
      });
    } catch (error: any) { return error.message || 'Không lưu được thao tác.'; }
  }, `LIFECYCLE_${request.action}`, expectedRevision);
  const openLifecycle = (action: 'FINISH' | 'CANCEL' | 'SWAP') => {
    if (service) setLifecycleModal({ service: structuredClone(service), action });
  };
  const pauseEmployee = (employeeId: string) => runLifecycle({ action: 'PAUSE', employeeId });
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
    }, 'DISPATCH', dispatchRevision(service.options));
  };

  const redispatchB = () => {
    if (!service || !b || !['PREPARING','READY','IN_PROGRESS'].includes(service.status || '')) {
      alert('Chọn và gán B trước khi cập nhật phân công.'); return;
    }
    change(() => {}, 'DISPATCH', dispatchRevision(service.options));
  };

  const openHandoff = (_itemId: string, _fromKtvId: string, toKtvId: string, plannedStartTime?: string) => {
    if (!service || !isTwoSlotSequential(service.options) || !['PREPARING', 'IN_PROGRESS'].includes(service.status || '')) {
      alert('Gửi phân công A ở chế độ nối tiếp trước khi gán B.'); return;
    }
    const current = b && segmentOf(b);
    const start = current?.startTime && current.plannedEndAt
        ? localInput(new Date(new Date(current.plannedEndAt).getTime() - current.duration * 60_000))
        : localInput(new Date((a && plannedHandoffStartAt(localInput(new Date()).slice(0, 10), segmentOf(a))) || Date.now()));
    setHandoff({ ktvId: toKtvId || b?.ktvId || '', expectedRevision: dispatchRevision(service.options),
      start: plannedStartTime ? `${start.slice(0, 10)}T${plannedStartTime}` : start,
      duration: current?.duration ?? (a && segmentOf(a).actualEndTime
        ? suggestedHandoffMinutes(service.duration, segmentOf(a)) : remainingHandoffMinutes(service.duration, a ? segmentOf(a).duration : 0)) });
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
      if (s.options?.finishedAfterA || (old && segmentOf(old).actualStartTime) || !['PREPARING', 'IN_PROGRESS'].includes(s.status || '')) return 'Lượt B đã thay đổi. Tải lại phân công.';
      const end = new Date(startMs + handoff.duration * 60_000);
      const segment: DemoSegment = {
        id: old?.ktvId === handoff.ktvId ? segmentOf(old).id : `demo-b-${Date.now()}`,
        ktvId: handoff.ktvId, sequenceSlot: 2, roomId: segmentOf(a).roomId, bedId: segmentOf(a).bedId,
        startTime: handoff.start.slice(11, 16), endTime: localInput(end).slice(11),
        duration: handoff.duration, plannedStartAt: new Date(startMs).toISOString(), plannedEndAt: end.toISOString(),
      };
      if (old?.ktvId === handoff.ktvId) old.segments = old.segments.map(previous => previous.id === segment.id ? segment : previous);
      else {
        if (old) segmentOf(old).voided = true;
        const returning = s.staffList.find(row => row.ktvId === handoff.ktvId);
        if (returning) returning.segments = [segment, ...returning.segments];
        else s.staffList.push({ id: `demo-row-${handoff.ktvId}`, ktvId: handoff.ktvId,
          serviceNameForKtv: ktvMetadataValue(parseKtvOptions(s.options).serviceNamesForKtvs, handoff.ktvId) ?? '',
          noteForKtv: ktvMetadataValue(parseKtvOptions(s.options).notesForKtvs, handoff.ktvId) ?? '',
          ktvName: staff.find(person => person.id === handoff.ktvId)?.full_name || handoff.ktvId,
          segments: [segment] });
      }
    }, 'ASSIGN_B', handoff.expectedRevision);
    setHandoff(null);
  };
  const stampEmployee = (employeeId: string, field: 'actualStartTime' | 'actualEndTime') =>
    change(s => stampDemoAccount(s, employeeId, field), 'UPDATE');
  const stamp = (slot: number, field: 'actualStartTime' | 'actualEndTime') => {
    const employeeId = slot === 1 ? a?.ktvId : b?.ktvId;
    if (employeeId) stampEmployee(employeeId, field);
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
    <nav className="flex flex-wrap gap-2" aria-label="Góc nhìn demo">
      <a href="?" className="rounded border bg-white px-3 py-2">Điều phối</a>
      {staff.map(person => <a key={person.id} href={`?account=${person.id}`} className={`rounded border px-3 py-2 ${accountId === person.id ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Tài khoản {person.full_name}</a>)}
      <span className="self-center text-sm text-slate-500">Mở link tài khoản trong tab mới để test đồng thời.</span>
    </nav>
    {accountId ? <AccountDemo service={service} employeeId={accountId} employeeName={staff.find(person => person.id === accountId)?.full_name || accountId} now={now} onStamp={stampEmployee} onPause={isSequential ? pauseEmployee : undefined} /> : <>
    <section id="demo-quick" className="rounded-xl border bg-white p-4">
      <h2 className="mb-1 font-bold">1. Chọn KTV A, phòng, giường và giờ dự kiến</h2>
      <p className="mb-3 text-sm text-slate-500">Dùng bảng điều phối thật bên dưới. A chưa đủ phút của gói thì bảng gợi ý thêm người nối tiếp.</p>
      <QuickDispatchTable key={order.createdAt} services={[service]} orderId={order.id} rooms={[{ id: 'R01', name: 'Phòng 01', type: 'standard' }]}
        beds={[{ id: 'BED01', roomId: 'R01' }]} availableTurns={turns} staffs={staff} busyBedIds={[]}
        billCode={order.billCode} onUpdateServices={updated => change(s => {
          const before = s.staffList;
          const status = s.status;
          const incoming = updated[0];
          const conflict = liveDispatchConflict(segmentsOf(s), segmentsOf(incoming), s.options, incoming.options, s.status);
          if (conflict) return conflict;
          for (const row of incoming.staffList) {
            const previous = before.find(old => old.ktvId === row.ktvId && segmentOf(old).id === segmentOf(row).id);
            if (!previous) continue;
            const old = segmentOf(previous), next = segmentOf(row);
            const planChanged = next.startTime !== old.startTime || next.duration !== old.duration || next.endTime !== old.endTime;
            if (!planChanged) {
              next.plannedStartAt = old.plannedStartAt; next.plannedEndAt = old.plannedEndAt;
            } else if (Number(next.sequenceSlot) === 2 && !['NEW','WAITING'].includes(status || '')) {
              const minutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
              if (Math.abs(minutes(next.startTime) - minutes(old.startTime)) >= 720)
                return 'Giờ B có thể chuyển ngày; bấm icon đổi nhân viên để kiểm tra giờ';
              const day = old.plannedStartAt ? localInput(new Date(old.plannedStartAt)).slice(0,10) : localInput(new Date()).slice(0,10);
              const start = Date.parse(`${day}T${next.startTime}:00+07:00`);
              if (!Number.isFinite(start) || next.duration < 1) return 'Giờ/phút B không hợp lệ';
              const currentA = before.find(person => Number(segmentOf(person).sequenceSlot) === 1);
              const reference = currentA && plannedHandoffStartAt(day,segmentOf(currentA));
              if (reference && start < Date.parse(reference) && !confirm('Giờ B mới trước mốc kết thúc A. Vẫn lưu và cập nhật B?'))
                return 'Giờ B chưa được lưu.';
              next.plannedStartAt = new Date(start).toISOString(); next.plannedEndAt = new Date(start + next.duration * 60_000).toISOString();
            } else if (status === 'PREPARING' && !old.actualStartTime) next.plannedEndAt = plannedEndAt(next);
          }
          Object.assign(s, incoming);
          s.status = status;
          s.staffList.forEach(row => {
            segmentOf(row).ktvId = row.ktvId;
            row.segments.forEach(segment => {
              const previous = before.find(old => old.ktvId === row.ktvId)?.segments.find(old => old.id === segment.id);
              if (previous) {
                segment.actualStartTime = previous.actualStartTime;
                segment.actualEndTime = previous.actualEndTime;
              }
            });
          });
        }, 'DRAFT', dispatchRevision(updated[0].options))}
        onPrintGroup={() => alert('Demo local: không in phiếu.')} onSaveStaffRow={async () => { if (service.status === 'NEW') dispatchA(); else redispatchB(); return true; }}
        onLiveHandoff={openHandoff} />
    </section>
    <DispatchEditHistory services={[service]} />
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">2. Gửi phân công</h2>
      <div className="flex flex-wrap gap-2">
        <button disabled={!a || service.status !== 'NEW'} className="rounded bg-indigo-600 px-3 py-2 font-bold text-white disabled:opacity-40"
          onClick={dispatchA}>{isSequential && b ? 'Gửi phân công A + B' : 'Gửi phân công A'}</button>
        {b && ['PREPARING','READY','IN_PROGRESS'].includes(service.status || '') && <>
          <button className="rounded border px-3 py-2" onClick={() => alert('Đã lưu thông tin mới nhất. Demo tự lưu bản nháp vào localStorage.')}>Lưu thông tin</button>
          <button className="rounded bg-indigo-600 px-3 py-2 text-white" onClick={redispatchB}>Cập nhật & điều phối B</button>
        </>}
        <button className="rounded border px-3 py-2" onClick={() => { setHandoff(null); saveOrder(sampleOrder()); }}>Tạo dịch vụ mới</button>
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
            onClick={() => openHandoff(service.id, a?.ktvId || '', b?.ktvId || '')}>Chọn nhân viên làm tiếp</button>
          <button disabled={!canWork || !bSegment || !!bSegment.actualStartTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(2, 'actualStartTime')}>B bắt đầu</button>
          <button disabled={!bSegment?.actualStartTime || !!bSegment.actualEndTime} className="rounded bg-sky-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => stamp(2, 'actualEndTime')}>B hoàn tất</button>
          <button disabled={!['PREPARING','READY','IN_PROGRESS','PAUSED'].includes(service.status || '')} className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-40" onClick={() => openLifecycle('FINISH')}>Kết thúc</button>
          <button disabled={!canWork} className="rounded border px-3 py-2 text-amber-700 disabled:opacity-40" onClick={() => runLifecycle({ action: 'PAUSE' })}>Tạm dừng</button>
          <button disabled={service.status !== 'PAUSED'} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => runLifecycle({ action: 'RESUME' })}>Tiếp tục</button>
          <button disabled={service.status !== 'PAUSED'} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => openLifecycle('SWAP')}>Đổi nhân viên đang làm</button>
          <button disabled={!['PREPARING','READY','IN_PROGRESS','PAUSED','CLEANING','FEEDBACK'].includes(service.status || '')} className="rounded border px-3 py-2 text-rose-600 disabled:opacity-40" onClick={() => openLifecycle('CANCEL')}>Huỷ</button>
        </>}
      </div>
    </section>
    <section className="space-y-3">
      <h2 className="font-bold">4. Góc nhìn tài khoản A và B</h2>
      <div className="grid gap-4 md:grid-cols-2">{[a?.ktvId || 'DEMO-A', b?.ktvId || 'DEMO-B'].filter((id, index, ids) => ids.indexOf(id) === index).map(employeeId =>
        <AccountDemo key={employeeId} service={service} employeeId={employeeId} employeeName={staff.find(person => person.id === employeeId)?.full_name || employeeId} now={now} onStamp={stampEmployee} onPause={isSequential ? pauseEmployee : undefined} />)}</div>
    </section>
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">5. Theo dõi trên Kanban</h2>
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
        onPauseClick={() => openLifecycle('SWAP')}
        onPauseNow={() => { runLifecycle({ action: 'PAUSE' }); }}
        onResumeClick={() => { runLifecycle({ action: 'RESUME' }); }}
        onFinishEarlyPaused={() => openLifecycle('FINISH')}
        onCancelClick={() => openLifecycle('CANCEL')}
        onCustomerRating={(_id, rating) => change(s => { s.itemRating = rating; })}
        onKtvCommentClick={() => { const note = prompt('Nhận xét mẫu (lưu localStorage):'); if (note !== null) change(s => { s.handover_comment = note; }); }}
        onOpenRatingLink={() => alert('Demo local: dùng các nút sao trên Kanban để đánh giá mẫu.')} />
      </div>
    </section>
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Xem JSON đang lưu</summary>
      <pre className="overflow-auto text-xs">{JSON.stringify(order, null, 2)}</pre></details>
    </>}
    {lifecycleModal && <SequentialLifecycleModal service={lifecycleModal.service} action={lifecycleModal.action} staffs={staff}
      onClose={() => setLifecycleModal(null)} onConfirm={async request => {
        if (!runLifecycle(request, dispatchRevision(lifecycleModal.service.options))) throw new Error('Chưa lưu thao tác. Kiểm tra phạm vi và tải lại thông tin mới nhất.');
      }} />}
    {handoff && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Gán lượt B demo">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5">
        <h2 className="font-bold">Chọn nhân viên làm tiếp</h2>
        <label className="block">KTV B<select className="mt-1 w-full rounded border p-2" value={handoff.ktvId}
          onChange={event => setHandoff({ ...handoff, ktvId: event.target.value })}>
          <option value="">Chọn KTV</option>{staff.filter(person => person.id !== a?.ktvId).map(person =>
            <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>
        <label className="block">B bắt đầu dự kiến<input type="datetime-local" className="mt-1 w-full rounded border p-2"
          value={handoff.start} onChange={event => setHandoff({ ...handoff, start: event.target.value })} /></label>
        <label className="block">Phút B<input type="number" min="1" max="600" className="mt-1 w-full rounded border p-2"
          value={handoff.duration} onChange={event => setHandoff({ ...handoff, duration: Number(event.target.value) })} /></label>
        <div className="flex justify-end gap-2"><button onClick={() => setHandoff(null)}>Hủy</button>
          <button className="rounded bg-indigo-600 px-3 py-2 text-white" onClick={saveHandoff}>Lưu & điều phối</button></div>
      </div>
    </div>}
  </main>;
}
