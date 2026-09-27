'use client';
import { useState } from 'react';
import type { ServiceBlock, StaffData } from '../types';
import { parseKtvSegments } from '@/lib/ktvUtils';
import { workedMsOf } from '@/lib/segment-time';
import type { SequentialRequest } from '@/lib/sequential-lifecycle';

export default function SequentialLifecycleModal({ service, action, staffs, onClose, onConfirm }: {
  service: ServiceBlock; action: 'FINISH' | 'CANCEL' | 'SWAP'; staffs: StaffData[];
  onClose: () => void; onConfirm: (request: SequentialRequest) => Promise<void>;
}) {
  const [scope, setScope] = useState('');
  const [credit, setCredit] = useState(false);
  const [reason, setReason] = useState('');
  const [newKtvId, setNewKtvId] = useState('');
  const [minutes, setMinutes] = useState(0);
  const [saving, setSaving] = useState(false);
  const segments = parseKtvSegments(service.staffList.flatMap(row => row.segments.map(seg => ({ ...seg, ktvId: row.ktvId }))));
  const live = segments.filter(seg => seg.voided !== true && seg.voided !== 'true');
  const slots = scope === 'both' ? [1, 2] : scope ? [Number(scope)] : [];
  const title = action === 'FINISH' ? 'Kết thúc lượt làm' : action === 'CANCEL' ? 'Huỷ lượt làm' : 'Đổi nhân viên';
  const submit = async () => {
    if (!slots.length || saving) return;
    setSaving(true);
    try {
      await onConfirm({ action, targetSlots: slots, reason, cancelCredit: credit ? 'WORKED' : 'NONE',
        ...(action === 'SWAP' ? { newKtvId, assignedMins: minutes } : {}) });
      onClose();
    } catch (error: any) { alert(error.message || 'Không lưu được thao tác.'); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-sm text-slate-600">{service.serviceName} · Chọn rõ phạm vi áp dụng.</p>
      <fieldset className="space-y-2" disabled={saving}>
        <legend className="mb-2 text-sm font-bold">Áp dụng cho ai?</legend>
        {[1, 2].map(slot => {
          const seg = live.find(seg => Number(seg.sequenceSlot) === slot);
          const row = service.staffList.find(row => row.ktvId === seg?.ktvId);
          const closed = (service.options?.closedSequentialSlots || []).includes(slot);
          return <label key={slot} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            <input type="radio" name="sequential-scope" value={slot} checked={scope === String(slot)}
              disabled={action === 'SWAP' && (!seg || !!seg.actualEndTime)} onChange={() => {
                setScope(String(slot));
                const end = seg?.actualEndTime || service.pauseStart || Date.now();
                setMinutes(seg ? Math.max(1, Number(seg.duration) - Math.round((workedMsOf(seg, end) || 0) / 60000)) : 0);
              }} />
            <span><strong>Chỉ {slot === 1 ? 'A' : 'B'}</strong> · {row?.ktvName || seg?.ktvId || 'Chưa gán'}<br />
              <span className="text-xs text-slate-500">{closed && !seg ? 'Đã đóng lượt' : seg?.actualEndTime ? 'Đã hoàn thành' : seg?.actualStartTime ? service.status === 'PAUSED' ? 'Đang tạm dừng' : 'Đang làm' : 'Chưa bắt đầu'}</span></span>
          </label>;
        })}
        {action !== 'SWAP' && <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
          <input type="radio" name="sequential-scope" value="both" checked={scope === 'both'} onChange={() => setScope('both')} />
          <strong>Cả A và B</strong>
        </label>}
      </fieldset>
      {action === 'CANCEL' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={credit} disabled={saving} onChange={e => setCredit(e.target.checked)} />Cộng giờ đã làm cho người được chọn</label>}
      {action === 'CANCEL' && !credit && slots.some(slot => live.some(seg => Number(seg.sequenceSlot) === slot && seg.actualEndTime)) &&
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">Có nhân viên đã hoàn thành trong phạm vi chọn. Huỷ không cộng giờ sẽ tước công và tua của người đó; giữ nguyên mốc giờ để đối soát.</p>}
      {action === 'FINISH' && <p className="text-xs text-slate-500">Lượt đã hoàn thành giữ nguyên giờ. Lượt chưa bắt đầu được đóng với 0 phút; các lượt không được chọn vẫn tiếp tục.</p>}
      {action === 'SWAP' && <>
        <label className="block text-sm font-bold">Nhân viên thay thế<select className="mt-1 w-full rounded-lg border p-2" value={newKtvId} disabled={saving} onChange={e => setNewKtvId(e.target.value)}>
          <option value="">Chọn nhân viên</option>{staffs.filter(staff => !live.some(seg => seg.ktvId === staff.id)).map(staff => <option key={staff.id} value={staff.id}>{staff.full_name || staff.id}</option>)}
        </select></label>
        <label className="block text-sm font-bold">Thời lượng người thay thế (phút)<input type="number" min="1" max="600" className="mt-1 w-full rounded-lg border p-2" value={minutes} disabled={saving} onChange={e => setMinutes(Number(e.target.value))} /></label>
      </>}
      <label className="block text-sm font-bold">Lý do<textarea maxLength={500} rows={2} className="mt-1 w-full rounded-lg border p-2 font-normal" value={reason} disabled={saving} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-lg border px-4 py-2" disabled={saving} onClick={onClose}>Đóng</button>
        <button type="button" className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={saving || !scope || action === 'SWAP' && (!newKtvId || !reason.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 600)} onClick={submit}>{saving ? 'Đang lưu…' : 'Xác nhận'}</button>
      </div>
    </div>
  </div>;
}
