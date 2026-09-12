'use client';

import React from 'react';
import { useAdminKtvOfficeLogic } from './AdminKtvOffice.logic';
import { Search, ChevronLeft, ChevronRight, X, Image as ImageIcon, Pencil, Undo2, Trash2, Plus, SlidersHorizontal, Timer, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { AppLayout } from '@/components/layout/AppLayout';
import { fmtHours } from '@/lib/hours-format';
import { dayPickState, DayTone } from '@/lib/office-calendar';

// 🔧 UI CONFIGURATION
const CSS_VARS = {
  '--bg': '#f4f1e9',
  '--surface': '#ffffff',
  '--surface-soft': '#f8f7f2',
  '--ink': '#1f2b23',
  '--muted': '#748074',
  '--line': '#e4e0d5',
  '--green': '#355b43',
  '--green-2': '#e7efe8',
  '--rust': '#a6533d',
  '--rust-2': '#f8ece7',
  '--amber': '#9a6a20',
  '--amber-2': '#fbf1dc',
  '--shadow': '0 14px 42px rgba(31, 43, 35, .10)',
  '--radius': '22px',
} as React.CSSProperties;


const fmtNum = (n: number) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** Mốc thời gian ngắn gọn cho lịch sử: 23:33 08/09. */
const fmtStamp = (at: string) =>
  new Date(at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

/**
 * Một phiếu trừ điểm trong timeline, kèm hai thao tác sửa sai:
 *  - Sửa: chấm nhầm tiêu chí, thiếu ghi chú hoặc thiếu ảnh thì vá tại chỗ.
 *  - Thu hồi: phiếu sai hẳn, hoàn điểm cho KTV nhưng vẫn giữ dấu vết.
 */
const HitRow = ({ hit, logic }: { hit: any; logic: any }) => {
  const editing = logic.editState?.logId === hit.logId;
  const revoking = logic.revokeState?.logId === hit.logId;

  if (editing) {
    const e = logic.editState;
    const photoCount = e.keptPhotos.length + e.newPhotos.length;
    return (
      <div className="bg-white border-2 border-[var(--green)] rounded-xl p-3 mb-2">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Tiêu chí</label>
        <select
          value={e.criteriaId}
          onChange={ev => logic.patchEdit({ criteriaId: ev.target.value })}
          className="w-full h-11 px-3 rounded-xl border border-[var(--line)] bg-white text-sm font-semibold mb-3"
        >
          {logic.allCriteria.map((c: any) => (
            <option key={c.id} value={c.id}>{c.label} (−{fmtNum(c.points)}đ)</option>
          ))}
        </select>

        <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Ghi chú</label>
        <textarea
          value={e.note}
          onChange={ev => logic.patchEdit({ note: ev.target.value })}
          className="w-full min-h-[64px] p-3 rounded-xl border border-[var(--line)] text-sm mb-3"
          placeholder="Ghi chú gửi cho KTV"
        />

        <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-2">
          Ảnh minh chứng ({photoCount}/{logic.maxPhotos})
        </label>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          {e.keptPhotos.map((u: string) => (
            <div key={u} className="relative w-[54px] h-[54px] rounded-xl overflow-hidden border border-[var(--line)]">
              <img src={u} alt="Minh chứng" className="w-full h-full object-cover" />
              <button
                onClick={() => logic.removeEditPhoto(u)}
                aria-label="Bỏ ảnh này"
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-[var(--rust)] text-white text-xs flex items-center justify-center"
              >✕</button>
            </div>
          ))}
          {e.newPhotos.map((src: string, i: number) => (
            <div key={`new-${i}`} className="relative w-[54px] h-[54px] rounded-xl overflow-hidden border-2 border-[var(--green)]">
              <img src={src} alt={`Ảnh mới ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => logic.removeEditNewPhoto(i)}
                aria-label={`Bỏ ảnh mới ${i + 1}`}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-[var(--rust)] text-white text-xs flex items-center justify-center"
              >✕</button>
            </div>
          ))}
          {photoCount < logic.maxPhotos && (
            <label className="h-[54px] px-3 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--surface-soft)] flex items-center gap-2 cursor-pointer text-xs font-bold text-[var(--green)]">
              <ImageIcon size={14} /> Thêm ảnh
              <input
                type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={ev => { logic.addEditPhotos(ev.target.files); ev.target.value = ''; }}
              />
            </label>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={logic.saveEditLog}
            disabled={logic.logBusy}
            className="flex-1 h-10 rounded-xl font-bold btn-primary disabled:opacity-50"
          >{logic.logBusy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
          <button onClick={logic.cancelEditLog} className="w-20 h-10 rounded-xl font-bold btn-ghost">Hủy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface-soft)] rounded-xl p-3 mb-2">
      <div className="flex justify-between gap-3">
        <strong className="text-sm">{hit.label}</strong>
        <b className="text-[var(--rust)] text-sm whitespace-nowrap">−{fmtNum(hit.points)}đ</b>
      </div>
      {hit.note && <p className="text-xs text-[var(--muted)] mt-1">{hit.note}</p>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {hit.photoUrls.map((u: string, i: number) => (
          <a key={i} href={u} target="_blank" rel="noreferrer"
             className="w-7 h-7 rounded border border-[var(--line)] flex items-center justify-center bg-white">
            <ImageIcon size={13} className="text-[var(--muted)]" />
          </a>
        ))}
        <span className="text-xs text-[var(--muted)]">
          Trừ bởi: {hit.byName} · {fmtStamp(hit.at)}
        </span>
      </div>

      {revoking ? (
        <div className="mt-3 pt-3 border-t border-[var(--line)]">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">
            Lý do thu hồi <span className="text-[var(--rust)]">*</span>
          </label>
          <textarea
            value={logic.revokeState.reason}
            onChange={ev => logic.setRevokeReason(ev.target.value)}
            placeholder="Ví dụ: Chấm nhầm KTV, đã xác minh lại với quản ca."
            className="w-full min-h-[64px] p-3 rounded-xl border border-[var(--line)] text-sm mb-2"
          />
          <p className="text-xs text-[var(--muted)] mb-2">
            Điểm được hoàn lại ngay. Phiếu vẫn lưu kèm lý do và người thu hồi để đối chiếu sau này.
          </p>
          <div className="flex gap-2">
            <button
              onClick={logic.confirmRevokeLog}
              disabled={logic.logBusy}
              className="flex-1 h-10 rounded-xl font-bold btn-danger disabled:opacity-50"
            >{logic.logBusy ? 'Đang thu hồi…' : `Xác nhận thu hồi, hoàn ${fmtNum(hit.points)}đ`}</button>
            <button onClick={logic.cancelRevokeLog} className="w-20 h-10 rounded-xl font-bold btn-ghost">Hủy</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-2 pt-2 border-t border-[var(--line)]">
          <button
            onClick={() => logic.startEditLog(hit)}
            className="h-8 px-3 rounded-lg text-xs font-bold btn-ghost flex items-center gap-1"
          ><Pencil size={13} /> Sửa</button>
          {logic.canRevoke && (
            <button
              onClick={() => logic.startRevokeLog(hit.logId)}
              className="h-8 px-3 rounded-lg text-xs font-bold btn-danger flex items-center gap-1"
            ><Undo2 size={13} /> Thu hồi</button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Một phiếu ĐÃ THU HỒI trong timeline.
 *
 * Vẫn nằm nguyên chỗ cũ, chỉ đổi trạng thái: điểm gạch ngang vì đã hoàn, và hiện
 * đủ người trừ — người hoàn — lý do. Xoá khỏi lịch sử thì tháng sau tranh chấp
 * không còn gì để tra. Không có nút Sửa / Thu hồi vì phiếu đã đóng.
 */
const RevokedHitRow = ({ hit }: { hit: any }) => (
  <div className="bg-[var(--surface-soft)] rounded-xl p-3 mb-2 opacity-70">
    <div className="flex justify-between gap-3 items-start">
      <div className="min-w-0">
        <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] border border-[var(--line)] rounded px-1.5 py-0.5 mb-1">
          Đã thu hồi
        </span>
        <strong className="text-sm block line-through">{hit.label}</strong>
      </div>
      <b className="text-[var(--muted)] text-sm whitespace-nowrap line-through">−{fmtNum(hit.points)}đ</b>
    </div>
    {hit.note && <p className="text-xs text-[var(--muted)] mt-1">{hit.note}</p>}
    {hit.photoUrls?.length > 0 && (
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {hit.photoUrls.map((u: string, i: number) => (
          <a key={i} href={u} target="_blank" rel="noreferrer"
             className="w-7 h-7 rounded border border-[var(--line)] flex items-center justify-center bg-white">
            <ImageIcon size={13} className="text-[var(--muted)]" />
          </a>
        ))}
      </div>
    )}
    <div className="text-xs text-[var(--muted)] mt-2 pt-2 border-t border-[var(--line)] space-y-0.5">
      <p>Trừ bởi: {hit.byName} · {fmtStamp(hit.at)}</p>
      <p className="text-[var(--green)]">Hoàn bởi: {hit.revokedByName} · {fmtStamp(hit.revokedAt)}</p>
      {hit.revokeReason && <p>Lý do: {hit.revokeReason}</p>}
    </div>
  </div>
);

// 🔧 UI CONFIGURATION — bộ chọn tháng
const MONTH_LABELS = ['Th 1', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'Th 8', 'Th 9', 'Th 10', 'Th 11', 'Th 12'];

/**
 * Ô chọn "Kỳ xem" của sheet Lịch sử.
 *
 * Trước đây là `<input type="month">` thuần: Windows tự vẽ một hộp đen tháng
 * tiếng Anh kèm hai dòng "Clear / This month" chẳng ăn nhập gì với trang, và
 * cho chọn cả tháng tương lai. Tự vẽ để đúng tông màu, đúng tiếng Việt, và
 * khoá thẳng những tháng chưa tới.
 *
 * `max` là tháng hiện tại ('YYYY-MM'). So sánh chuỗi 'YYYY-MM' là đủ vì định
 * dạng này sắp theo thứ tự từ điển trùng với thứ tự thời gian.
 */
const MonthPicker = ({ value, max, onPick, onStep }: {
  value: string;
  max: string;
  onPick: (month: string) => void;
  onStep: (delta: number) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(() => Number(value.slice(0, 4)));

  // Mở lại là về đúng năm đang xem, không giữ năm của lần mở trước.
  React.useEffect(() => { if (open) setYear(Number(value.slice(0, 4))); }, [open, value]);

  const monthOf = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const maxYear = Number(max.slice(0, 4));
  const atMax = value >= max;

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2 bg-[var(--surface-soft)] p-2 rounded-2xl">
        <button
          onClick={() => onStep(-1)}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white"
          aria-label="Tháng trước"
        ><ChevronLeft size={20} /></button>

        <button
          onClick={() => setOpen(v => !v)}
          className={`flex-1 py-1 rounded-xl transition-colors ${open ? 'bg-white shadow-sm' : 'hover:bg-white'}`}
        >
          <span className="block text-[10px] uppercase tracking-widest text-[var(--muted)]">Kỳ xem</span>
          <span className="flex items-center justify-center gap-1.5 font-bold text-sm">
            Tháng {Number(value.slice(5))}/{value.slice(0, 4)}
            <CalendarDays size={14} className="text-[var(--green)]" />
          </span>
        </button>

        <button
          onClick={() => onStep(1)}
          disabled={atMax}
          title={atMax ? 'Đây là tháng hiện tại' : 'Tháng sau'}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Tháng sau"
        ><ChevronRight size={20} /></button>
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-2 p-3 bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setYear(y => y - 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--surface-soft)]"
              aria-label="Năm trước"
            ><ChevronLeft size={16} /></button>
            <b className="text-sm">Năm {year}</b>
            <button
              onClick={() => setYear(y => y + 1)}
              disabled={year >= maxYear}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--surface-soft)] disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Năm sau"
            ><ChevronRight size={16} /></button>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {MONTH_LABELS.map((label, i) => {
              const m = monthOf(i + 1);
              const disabled = m > max;
              const active = m === value;
              return (
                <button
                  key={label}
                  disabled={disabled}
                  onClick={() => { onPick(m); setOpen(false); }}
                  title={disabled ? 'Tháng này chưa tới' : undefined}
                  className={`h-9 rounded-xl text-xs font-bold transition-colors ${
                    active
                      ? 'bg-[var(--green)] text-white'
                      : disabled
                        ? 'text-[var(--muted)] opacity-30'
                        : 'bg-[var(--surface-soft)] hover:bg-[var(--green-2)]'
                  }`}
                >{label}</button>
              );
            })}
          </div>

          <div className="flex justify-between items-center mt-3 pt-2 border-t border-[var(--line)]">
            <button
              onClick={() => { onPick(max); setOpen(false); }}
              className="text-xs font-bold text-[var(--green)]"
            >Tháng này</button>
            <button onClick={() => setOpen(false)} className="text-xs font-bold text-[var(--muted)]">Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Ngày kiểu "Thứ 3, 08/09" cho timeline. */
const fmtDay = (iso: string) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
  catch { return iso; }
};

/**
 * Timeline "Chi tiết vi phạm" — gộp phiếu còn hiệu lực và phiếu đã thu hồi theo
 * từng ngày.
 *
 * Ngày lấy từ HỢP của hai nguồn: phiếu đã thu hồi có thể rơi vào ngày KTV không
 * đi làm (chấm nhầm ngày rồi hoàn), ngày đó không nằm trong `days` nhưng vẫn
 * phải hiện ra, nếu không thì dấu vết chấm nhầm biến mất.
 */
const ViolationTimeline = ({ office, logic }: { office: any; logic: any }) => {
  const daysWithHits = (office.days || []).filter((d: any) => d.hits.length > 0);
  const revoked: any[] = office.revokedHits || [];

  const revokedByDate = new Map<string, any[]>();
  revoked.forEach(h => {
    if (!revokedByDate.has(h.workDate)) revokedByDate.set(h.workDate, []);
    revokedByDate.get(h.workDate)!.push(h);
  });
  // Điểm ngày chỉ có với ngày đi làm; ngày không đi làm để trống chứ không bịa 100.
  const scoreByDate = new Map<string, number>((office.days || []).map((d: any) => [d.workDate, d.dayScore]));

  const dates = [...new Set([
    ...daysWithHits.map((d: any) => d.workDate),
    ...revokedByDate.keys(),
  ])].sort((a, b) => String(b).localeCompare(String(a)));

  if (dates.length === 0) {
    return <p className="py-8 text-center text-[var(--muted)] text-sm">Tháng này chưa có phiếu trừ điểm nào.</p>;
  }

  const hitsOf = new Map<string, any[]>(daysWithHits.map((d: any) => [d.workDate, d.hits]));

  return (
    <div className="pl-6 border-l-2 border-[var(--line)] ml-2">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] mb-3 -ml-6">Chi tiết vi phạm</p>
      {dates.map(date => {
        const hits = hitsOf.get(date) || [];
        const score = scoreByDate.get(date);
        return (
          <div key={date} className="relative pb-6">
            <div className={`absolute w-3.5 h-3.5 rounded-full border-2 bg-white -left-[32px] top-1 ${
              hits.length > 0 ? 'border-[var(--rust)]' : 'border-[var(--line)]'
            }`}></div>
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-xs text-[var(--muted)]">{fmtDay(date)}</span>
              <b className="text-sm">{score === undefined ? '—' : `${fmtNum(score)} / 100`}</b>
            </div>
            {hits.map((h: any) => (
              <HitRow key={h.logId} hit={h} logic={logic} />
            ))}
            {(revokedByDate.get(date) || []).map((h: any) => (
              <RevokedHitRow key={h.logId} hit={h} />
            ))}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Cài đặt bộ tiêu chí — sửa nhãn, sửa điểm, đặt trần từng nhóm, thêm và xoá ngay
 * trên trang, để quy chế đổi mà không phải sửa code rồi deploy lại.
 *
 * Trần nhóm là ràng buộc thật: tổng điểm các tiêu chí đang áp dụng không được vượt
 * trần. Chặn ngay ở đây cho người dùng thấy trước, server vẫn kiểm lại lần nữa.
 */
const CriteriaSettings = ({ logic }: { logic: any }) => {
  const [drafts, setDrafts] = React.useState<Record<string, any>>({});
  const [groupDrafts, setGroupDrafts] = React.useState<Record<string, any>>({});
  const [adding, setAdding] = React.useState<Record<string, any>>({});

  /** Giá trị đang gõ dở; chưa đụng tới thì lấy nguyên giá trị trong DB. */
  const draftFrom = (store: Record<string, any>, item: any) => store[item.id] || {
    label: item.label ?? '',
    points: item.points ?? 0,
    requiresPhoto: !!item.requiresPhoto,
  };
  const draftOf = (item: any) => draftFrom(drafts, item);

  // Phải trộn lên bản ĐẦY ĐỦ của dòng, không phải lên {} — gõ vào ô tên mà chỉ lưu
  // mỗi `label` thì `points` thành undefined và ô điểm rơi từ controlled sang uncontrolled.
  const setDraft = (item: any, patch: any) =>
    setDrafts(prev => ({ ...prev, [item.id]: { ...draftFrom(prev, item), ...patch } }));

  const groupDraftFrom = (store: Record<string, any>, group: any) => store[group.grp] || {
    grpLabel: group.grpLabel ?? '',
    grpMax: group.max ?? 0,
  };
  const groupDraftOf = (group: any) => groupDraftFrom(groupDrafts, group);
  const setGroupDraft = (group: any, patch: any) =>
    setGroupDrafts(prev => ({ ...prev, [group.grp]: { ...groupDraftFrom(prev, group), ...patch } }));

  const isDirty = (item: any) => {
    const d = drafts[item.id];
    if (!d) return false;
    return d.label !== item.label || Number(d.points) !== Number(item.points) || d.requiresPhoto !== item.requiresPhoto;
  };
  const isGroupDirty = (group: any) => {
    const d = groupDrafts[group.grp];
    if (!d) return false;
    return d.grpLabel !== group.grpLabel || Number(d.grpMax) !== Number(group.max);
  };

  /** Tổng điểm nhóm sẽ thành bao nhiêu nếu lưu hết những gì đang gõ dở. */
  const usedOf = (group: any) => {
    const sum = (group.items || [])
      .filter((i: any) => i.isActive)
      .reduce((a: number, i: any) => a + (Number(draftOf(i).points) || 0), 0);
    return Math.round(sum * 100) / 100;
  };
  const capOf = (group: any) => Number(groupDraftOf(group).grpMax) || 0;

  const saveRow = async (item: any) => {
    const d = draftOf(item);
    await logic.saveCriteria(item.id, {
      label: d.label,
      points: Number(d.points),
      requiresPhoto: !!d.requiresPhoto,
    });
    setDrafts(prev => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const saveGroup = async (group: any) => {
    const d = groupDraftOf(group);
    const ok = await logic.saveGroup(group.grp, { grpLabel: d.grpLabel, grpMax: Number(d.grpMax) });
    if (ok) {
      setGroupDrafts(prev => {
        const next = { ...prev };
        delete next[group.grp];
        return next;
      });
    }
  };

  const addRow = async (grp: string) => {
    const d = adding[grp] || {};
    const ok = await logic.addCriteria(grp, {
      label: d.label || '',
      points: Number(d.points),
      requiresPhoto: !!d.requiresPhoto,
    });
    if (ok) setAdding(prev => ({ ...prev, [grp]: null }));
  };

  // Lăn chuột trên ô số của Chrome sẽ đổi giá trị mà người dùng không hề gõ —
  // trên màn này là âm thầm sửa quy chế, nên bỏ focus trước khi trang cuộn.
  const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

  if (logic.settingsLoading && logic.settingsGroups.length === 0) {
    return <p className="py-10 text-center text-[var(--muted)]">Đang tải bộ tiêu chí…</p>;
  }

  const capTotal = logic.settingsGroups.reduce((a: number, g: any) => a + capOf(g), 0);

  return (
    <>
      <div className="bg-[var(--surface-soft)] p-4 rounded-2xl mb-5 text-sm">
        <p className="font-bold mb-1">Sửa quy chế ngay tại đây</p>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Đổi tên, đổi điểm hay thêm tiêu chí đều áp dụng cho <b>phiếu chấm từ lúc này trở đi</b>.
          Phiếu đã chấm giữ nguyên nhãn và điểm cũ, nên lịch sử tháng trước không bị sai.
        </p>
        <div className="flex justify-between items-baseline mt-2 pt-2 border-t border-[var(--line)]">
          <span className="text-xs text-[var(--muted)]">Tổng trần 3 nhóm</span>
          <b className={capTotal === 100 ? 'text-[var(--green)]' : 'text-[var(--rust)]'}>
            {fmtNum(capTotal)}đ / 100đ
          </b>
        </div>
        {capTotal !== 100 && (
          <p className="text-xs text-[var(--rust)] mt-1">
            Điểm mỗi ngày của KTV bắt đầu từ 100. Tổng trần 3 nhóm lệch 100 nghĩa là cơ cấu điểm đã sai —
            {capTotal > 100 ? ' trừ hết mọi lỗi sẽ âm điểm.' : ' có phần điểm không lỗi nào chạm tới được.'}
          </p>
        )}
        {!logic.isManager && (
          <p className="text-xs text-[var(--rust)] font-bold mt-2">
            Bạn đang xem ở chế độ chỉ đọc — chỉ Quản lý mới sửa được bộ tiêu chí.
          </p>
        )}
      </div>

      {logic.settingsGroups.map((group: any) => {
        const gd = groupDraftOf(group);
        const cap = capOf(group);
        const used = usedOf(group);
        const over = used > cap;
        const left = Math.round((cap - used) * 100) / 100;
        const groupDirty = isGroupDirty(group);

        return (
          <div key={group.grp} className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-9 h-9 shrink-0 rounded-xl bg-[var(--green-2)] text-[var(--green)] font-bold flex items-center justify-center text-sm">{group.grp}</span>
              <input
                value={gd.grpLabel}
                disabled={!logic.isManager}
                onChange={e => setGroupDraft(group, { grpLabel: e.target.value })}
                className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-[var(--line)] bg-white font-bold text-sm disabled:bg-transparent disabled:border-transparent disabled:px-0"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-[var(--muted)]">Trần</span>
                <input
                  type="number" min={0} step={0.5}
                  value={gd.grpMax}
                  disabled={!logic.isManager}
                  onWheel={blurOnWheel}
                  onChange={e => setGroupDraft(group, { grpMax: e.target.value })}
                  className="w-16 h-10 px-2 rounded-xl border border-[var(--line)] bg-white text-sm font-bold text-right disabled:bg-transparent disabled:border-transparent"
                />
                <span className="text-xs text-[var(--muted)]">đ</span>
              </div>
              {logic.isManager && groupDirty && (
                <button
                  onClick={() => saveGroup(group)}
                  disabled={!!logic.savingId}
                  className="h-10 px-3 rounded-xl text-xs font-bold btn-primary shrink-0"
                >{logic.savingId === `grp-${group.grp}` ? 'Đang lưu…' : 'Lưu nhóm'}</button>
              )}
            </div>

            <div className={`flex justify-between items-baseline text-xs mb-2 px-1 ${over ? 'text-[var(--rust)] font-bold' : 'text-[var(--muted)]'}`}>
              <span>Đang dùng {fmtNum(used)} / {fmtNum(cap)}đ</span>
              <span>
                {over
                  ? `Vượt trần ${fmtNum(used - cap)}đ — hạ điểm hoặc nâng trần trước khi lưu`
                  : left > 0 ? `Còn ${fmtNum(left)}đ chưa dùng` : 'Đã dùng hết trần'}
              </span>
            </div>

            <div className="border-t border-[var(--line)]">
              {group.items.map((item: any) => {
                const d = draftOf(item);
                const dirty = isDirty(item);
                return (
                  <div key={item.id} className={`py-3 border-b border-[var(--line)] ${item.isActive ? '' : 'opacity-55'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-mono font-bold text-[var(--muted)] w-8 shrink-0">{item.id}</span>
                      <input
                        value={d.label}
                        disabled={!logic.isManager}
                        onChange={e => setDraft(item, { label: e.target.value })}
                        className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-[var(--line)] bg-white text-sm disabled:bg-transparent disabled:border-transparent disabled:px-0"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[var(--rust)] font-bold text-sm">−</span>
                        <input
                          type="number" min={0.5} step={0.5}
                          value={d.points}
                          disabled={!logic.isManager}
                          onWheel={blurOnWheel}
                          onChange={e => setDraft(item, { points: e.target.value })}
                          className={`w-16 h-10 px-2 rounded-xl border bg-white text-sm font-bold text-right disabled:bg-transparent disabled:border-transparent ${over && item.isActive ? 'border-[var(--rust)]' : 'border-[var(--line)]'}`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap pl-10">
                      <label className={`flex items-center gap-1.5 text-xs ${logic.isManager ? 'cursor-pointer' : ''}`}>
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[var(--amber)]"
                          checked={!!d.requiresPhoto}
                          disabled={!logic.isManager}
                          onChange={e => setDraft(item, { requiresPhoto: e.target.checked })}
                        />
                        Bắt buộc ảnh
                      </label>

                      {item.usageCount > 0 && (
                        <span className="text-xs text-[var(--muted)]">đã dùng {item.usageCount} phiếu</span>
                      )}
                      {!item.isActive && (
                        <span className="text-[10px] font-bold text-[var(--rust)] bg-[var(--rust-2)] px-2 py-0.5 rounded">NGỪNG ÁP DỤNG</span>
                      )}

                      {logic.isManager && (
                        <div className="flex gap-2 ml-auto">
                          {dirty && (
                            <button
                              onClick={() => saveRow(item)}
                              disabled={logic.savingId === item.id || over}
                              title={over ? 'Tổng điểm của nhóm đang vượt trần' : undefined}
                              className="h-8 px-3 rounded-lg text-xs font-bold btn-primary disabled:opacity-50"
                            >{logic.savingId === item.id ? 'Đang lưu…' : 'Lưu'}</button>
                          )}
                          <button
                            onClick={() => logic.saveCriteria(item.id, { isActive: !item.isActive })}
                            disabled={!!logic.savingId}
                            className="h-8 px-3 rounded-lg text-xs font-bold btn-ghost"
                          >{item.isActive ? 'Tạm ngừng' : 'Dùng lại'}</button>
                          <button
                            onClick={() => logic.deleteCriteria(item.id, item.label, item.usageCount)}
                            disabled={!!logic.savingId}
                            className="h-8 px-3 rounded-lg text-xs font-bold btn-danger flex items-center gap-1"
                          ><Trash2 size={13} /> Xóa</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {logic.isManager && (
              adding[group.grp] ? (
                <div className="mt-3 p-3 rounded-2xl border-2 border-dashed border-[var(--green)] bg-[var(--surface-soft)]">
                  <input
                    autoFocus
                    placeholder="Tên tiêu chí mới"
                    value={adding[group.grp].label || ''}
                    onChange={e => setAdding(prev => ({ ...prev, [group.grp]: { ...prev[group.grp], label: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] bg-white text-sm mb-2"
                  />
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--muted)]">Điểm trừ</span>
                      <input
                        type="number" min={0.5} step={0.5}
                        value={adding[group.grp].points ?? ''}
                        onWheel={blurOnWheel}
                        onChange={e => setAdding(prev => ({ ...prev, [group.grp]: { ...prev[group.grp], points: e.target.value } }))}
                        className="w-16 h-9 px-2 rounded-xl border border-[var(--line)] bg-white text-sm font-bold text-right"
                      />
                      <span className="text-xs text-[var(--muted)]">/ còn {fmtNum(left)}đ</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[var(--amber)]"
                        checked={!!adding[group.grp].requiresPhoto}
                        onChange={e => setAdding(prev => ({ ...prev, [group.grp]: { ...prev[group.grp], requiresPhoto: e.target.checked } }))}
                      />
                      Bắt buộc ảnh
                    </label>
                    <div className="flex gap-2 ml-auto">
                      <button
                        onClick={() => addRow(group.grp)}
                        disabled={!!logic.savingId}
                        className="h-9 px-4 rounded-xl text-xs font-bold btn-primary disabled:opacity-50"
                      >{logic.savingId === `new-${group.grp}` ? 'Đang thêm…' : 'Thêm'}</button>
                      <button
                        onClick={() => setAdding(prev => ({ ...prev, [group.grp]: null }))}
                        className="h-9 px-3 rounded-xl text-xs font-bold btn-ghost"
                      >Hủy</button>
                    </div>
                  </div>
                  {Number(adding[group.grp].points) > left && (
                    <p className="text-xs text-[var(--rust)] font-bold mt-2">
                      Nhóm {group.grp} chỉ còn {fmtNum(left)}đ. Nâng trần nhóm hoặc hạ điểm tiêu chí khác trước.
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setAdding(prev => ({ ...prev, [group.grp]: { label: '', points: '', requiresPhoto: group.grp === 'III' } }))}
                  className="mt-3 h-10 px-4 rounded-xl text-sm font-bold btn-ghost border border-dashed border-[var(--line)] flex items-center gap-2"
                ><Plus size={15} /> Thêm tiêu chí vào nhóm {group.grp}</button>
              )
            )}
          </div>
        );
      })}
    </>
  );
};

/** '2026-09-05' → '05/09/2026' — cùng cách ô ngày của lịch KTV hiện. */
function fmtDayFull(iso: string): string {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/**
 * Màu từng loại ô — CÙNG bộ màu với lịch KTV ở modal Điểm Office
 * (`app/ktv/dashboard/_components/modals.tsx`), để quầy và KTV nhìn cùng một
 * ngày thấy cùng một màu.
 */
const DAY_TONE: Record<DayTone, string> = {
  clean: 'bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100',
  hit: 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100',
  hitOff: 'bg-rose-50 text-rose-600 border border-rose-100 opacity-50 cursor-not-allowed',
  off: 'bg-slate-50 text-slate-300 cursor-not-allowed',
  locked: 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-60',
  future: 'text-slate-200 cursor-not-allowed',
};

/**
 * Lịch chọn "Ngày vi phạm" trên sheet trừ điểm.
 *
 * Làm theo lưới của lịch KTV (tuần bắt đầu Thứ 2, ô xanh/đỏ/xám, dưới ô đỏ ghi
 * điểm ngày), nhưng thêm một việc lịch KTV không cần: KHOÁ những ngày không trừ
 * được — ngày tương lai, ngày cũ hơn hôm qua với lễ tân, và ngày KTV không đi làm.
 * Luật nằm ở `dayPickState` (lib/office-calendar.ts), dùng chung với kịch bản
 * kiểm thử `qa_14`.
 */
function DeductCalendar({ month, days, loading, today, selected, canPickOld, onPrev, onNext, onPick, onToday }: {
  month: string;
  days: any[];
  loading: boolean;
  today: string;
  selected: string;
  canPickOld: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPick: (iso: string) => void;
  onToday: () => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // getUTCDay(): CN = 0 → dịch để tuần bắt đầu Thứ 2, khớp lịch KTV.
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDate: Record<string, any> = {};
  days.forEach(d => { byDate[d.date] = d; });
  const isCurrentMonth = month >= String(today).slice(0, 7);

  return (
    <div className="bg-slate-50 rounded-2xl p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrev} aria-label="Tháng trước"
          className="w-8 h-8 rounded-lg bg-white text-slate-500 flex items-center justify-center shadow-sm">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-black text-slate-600">Tháng {Number(month.slice(5))}/{month.slice(0, 4)}</span>
        <button onClick={onNext} disabled={isCurrentMonth} aria-label="Tháng sau"
          className="w-8 h-8 rounded-lg bg-white text-slate-500 flex items-center justify-center shadow-sm disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => (
          <div key={d} className="text-center text-[9px] font-black uppercase text-slate-300 py-1">{d}</div>
        ))}
      </div>

      {loading ? (
        <p className="py-8 text-center text-slate-400 text-xs font-bold">Đang tải lịch…</p>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const iso = `${month}-${String(day).padStart(2, '0')}`;
            const info = byDate[iso];
            const pick = dayPickState({
              date: iso,
              today,
              canPickOld,
              // Chưa tải được dữ liệu ngày này thì đừng tự khoá — server vẫn chặn khi gửi.
              canDeduct: info ? info.canDeduct : true,
              hitCount: info?.hitCount || 0,
            });
            const isSelected = iso === selected;
            const tone = isSelected ? 'bg-indigo-600 text-white shadow-md' : DAY_TONE[pick.tone];

            return (
              <button
                key={iso}
                disabled={!pick.pickable}
                onClick={() => pick.pickable && onPick(iso)}
                title={pick.why || info?.label || ''}
                className={`aspect-square rounded-xl text-xs font-black flex flex-col items-center justify-center transition-colors ${tone} ${iso === today && !isSelected ? 'ring-2 ring-indigo-400' : ''}`}
              >
                {day}
                {(pick.tone === 'hit' || pick.tone === 'hitOff') && info?.dayScore != null && (
                  <span className={`text-[8px] font-bold leading-none ${isSelected ? 'text-white/80' : ''}`}>
                    {info.dayScore}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-200">
        <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-emerald-200" /> Không lỗi</span>
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-rose-200" /> Có lỗi</span>
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-slate-200" /> Nghỉ / không chọn được</span>
        </div>
        <button onClick={onToday}
          className="text-[10px] font-black uppercase tracking-widest text-indigo-600 shrink-0">Hôm nay</button>
      </div>
    </div>
  );
}

const AdminKtvOfficePage = () => {
  const logic = useAdminKtvOfficeLogic();
  
  // Phân loại KTV và tìm kiếm
  const filteredStaff = logic.staffList.filter(ktv => 
    ktv.name.toLowerCase().includes(logic.searchQuery.toLowerCase()) || 
    ktv.code.toLowerCase().includes(logic.searchQuery.toLowerCase())
  );
  const attentionList = filteredStaff.filter(ktv => ktv.locked || ktv.score < 90);
  const activeList = filteredStaff.filter(ktv => !ktv.locked && ktv.score >= 90);

  const fmtMoney = (n: number) => n.toLocaleString('vi-VN') + ' ₫';
  const fmtDate = (iso: string) => {
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <AppLayout title="Chấm Điểm Office">
      <div style={CSS_VARS} className="min-h-screen bg-[var(--bg)] text-[var(--ink)] font-sans pb-24">
      {/* CSS in JS fallback for specific styling needs */}
      <style dangerouslySetInnerHTML={{__html: `
        .person-card { background: var(--surface); border-radius: var(--radius); padding: 18px; box-shadow: 0 4px 18px rgba(31,43,35,.06); position: relative; }
        .person-card.attention { border-left: 4px solid var(--rust); }
        .btn-primary { background: var(--green); color: #fff; }
        .btn-primary:hover { background: #294c37; }
        .btn-danger { background: var(--rust-2); color: var(--rust); }
        .btn-ghost { color: var(--green); }
        .btn-ghost:hover { background: var(--green-2); }
      `}} />

      <main className="max-w-5xl mx-auto p-5 md:p-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <p className="text-[var(--green)] font-bold text-xs tracking-widest uppercase mb-1">Kỹ thuật viên loại D</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Chấm điểm KTV</h1>
            <div className="flex items-center gap-4 mt-3 text-[var(--muted)] text-sm">
              <span className="flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-[var(--green)]"></i><b className="text-[var(--ink)]">{activeList.length}</b> đang hoạt động</span>
              <span className="flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-[var(--rust)]"></i><b className="text-[var(--ink)]">{attentionList.length}</b> cần xử lý</span>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/admin/ktv-office/hours"
              className="h-12 px-4 rounded-2xl bg-[var(--surface)] shadow-sm font-bold text-sm flex items-center justify-center gap-2 hover:bg-[var(--green-2)]"
            ><Timer size={16} /> Giờ tích lũy</Link>
            <div className="flex items-center bg-[var(--surface)] p-1 rounded-2xl shadow-sm">
              <button onClick={() => logic.changeMonth(-1)} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-xl"><ChevronLeft size={20}/></button>
              <span className="min-w-[100px] text-center font-bold text-sm">Tháng {logic.month}</span>
              <button onClick={() => logic.changeMonth(1)} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-xl"><ChevronRight size={20}/></button>
            </div>
            <button
              onClick={() => logic.openSheet('settings')}
              className="h-12 px-5 rounded-2xl font-bold bg-[var(--surface)] shadow-sm flex items-center justify-center gap-2 text-sm"
            ><SlidersHorizontal size={17}/> Cài đặt tiêu chí</button>
          </div>
        </div>

        {/* Tools Section */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex-1 flex items-center gap-3 px-4 h-14 bg-[var(--surface)] rounded-2xl shadow-sm">
            <Search size={20} className="text-[var(--muted)]" />
            <input 
              type="search" 
              placeholder="Tìm tên hoặc mã KTV" 
              className="w-full bg-transparent border-none focus:outline-none text-[var(--ink)]"
              value={logic.searchQuery}
              onChange={e => logic.setSearchQuery(e.target.value)}
            />
          </div>
          <button onClick={logic.toggleFilter} className="h-14 px-6 font-bold bg-[var(--surface)] rounded-2xl shadow-sm">
            {logic.filterMode}
          </button>
        </div>

        {logic.loading && (
          <p className="py-16 text-center text-[var(--muted)]">Đang tải danh sách KTV…</p>
        )}

        {!logic.loading && logic.loadError && (
          <div className="bg-[var(--rust-2)] text-[var(--rust)] p-5 rounded-2xl flex items-center justify-between gap-4 flex-wrap">
            <span className="font-bold text-sm">{logic.loadError}</span>
            <button onClick={logic.refresh} className="h-10 px-4 rounded-xl font-bold btn-primary">Thử lại</button>
          </div>
        )}

        {!logic.loading && !logic.loadError && filteredStaff.length === 0 && (
          <p className="py-16 text-center text-[var(--muted)]">
            {logic.searchQuery ? 'Không tìm thấy KTV nào khớp.' : 'Chưa có KTV Loại D nào đang hoạt động.'}
          </p>
        )}

        {/* Cần xử lý */}
        {(logic.filterMode === 'Tất cả' || logic.filterMode === 'Cần xử lý') && attentionList.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-xs tracking-widest uppercase font-bold text-[var(--ink)]">Cần xử lý</h2>
              <span className="text-sm text-[var(--muted)]">{attentionList.length} KTV</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
              {attentionList.map(ktv => (
                <article key={ktv.code} className="person-card attention lg:flex lg:justify-between lg:items-center">
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[var(--green)] font-bold text-sm">{ktv.code}</span>
                        <h3 className="text-lg font-bold">{ktv.name}</h3>
                      </div>
                      {ktv.locked && <span className="px-3 py-1 rounded-full text-xs font-bold bg-[var(--rust-2)] text-[var(--rust)] lg:hidden">Đã khóa</span>}
                    </div>
                    <p className="text-[var(--rust)] text-sm mb-4">
                      {ktv.locked ? (ktv.lockReason || 'Tài khoản đang bị khóa') : 'Điểm tháng dưới 90'}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                      {/* Chưa có ngày công thì điểm tháng không có mẫu số — hiện
                          "100 điểm" ra là khai khống thành tích của người chưa đi làm. */}
                      <strong className="block text-xl">{ktv.hasData === false ? 'Chưa có dữ liệu' : `${fmtNum(ktv.score)} điểm`}</strong>
                      <span className="text-[var(--muted)] text-xs">Điểm tháng {logic.month} · {ktv.workDays} ngày làm</span>
                    </div>
                      <div><strong className="block text-xl">{fmtHours(ktv.hours)}</strong><span className="text-[var(--muted)] text-xs">Giờ tích lũy{ktv.rank ? ` · hạng ${ktv.rank}` : ''}</span></div>
                    </div>
                    {ktv.repeatPenalty > 0 && (
                      <p className="mt-3 inline-block text-xs font-bold text-[var(--amber)] bg-[var(--amber-2)] px-3 py-1.5 rounded-lg">
                        ↺ Lỗi lặp: {ktv.repeats.map((r: any) => `${r.label} ×${r.times}`).join(', ')} — trừ thêm {fmtNum(ktv.repeatPenalty)}đ
                      </p>
                    )}
                  </div>
                  {ktv.locked && <div className="hidden lg:block self-start"><span className="px-3 py-1 rounded-full text-xs font-bold bg-[var(--rust-2)] text-[var(--rust)]">Đã khóa</span></div>}
                  <div className="flex gap-2 mt-5 lg:mt-0 lg:flex-col lg:justify-center">
                    {ktv.locked && <button className="flex-1 lg:flex-none h-11 px-4 rounded-xl font-bold btn-primary" onClick={() => logic.openSheet('unlock', ktv.name, ktv.code)}>Mở khóa</button>}
                    <button className="flex-1 lg:flex-none h-11 px-4 rounded-xl font-bold btn-ghost" onClick={() => logic.openSheet('history', ktv.name, ktv.code)}>Lịch sử</button>
                    <button className="flex-1 lg:flex-none h-11 px-4 rounded-xl font-bold btn-ghost" onClick={() => logic.openSheet('deduct', ktv.name, ktv.code, ktv.score)}>Trừ điểm</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Đang hoạt động */}
        {(logic.filterMode === 'Tất cả' || logic.filterMode === 'Điểm thấp') && activeList.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-xs tracking-widest uppercase font-bold text-[var(--ink)]">Đang hoạt động</h2>
              <span className="text-sm text-[var(--muted)]">{activeList.length} KTV</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeList.map(ktv => (
                <article key={ktv.code} className="person-card flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[var(--green)] font-bold text-sm">{ktv.code}</span>
                      <h3 className="text-lg font-bold">{ktv.name}</h3>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-[var(--green-2)] text-[var(--green)] whitespace-nowrap">{ktv.status}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      {/* Chưa có ngày công thì điểm tháng không có mẫu số — hiện
                          "100 điểm" ra là khai khống thành tích của người chưa đi làm. */}
                      <strong className="block text-xl">{ktv.hasData === false ? 'Chưa có dữ liệu' : `${fmtNum(ktv.score)} điểm`}</strong>
                      <span className="text-[var(--muted)] text-xs">Điểm tháng {logic.month} · {ktv.workDays} ngày làm</span>
                    </div>
                    <div><strong className="block text-xl">{fmtHours(ktv.hours)}</strong><span className="text-[var(--muted)] text-xs">Giờ tích lũy{ktv.rank ? ` · hạng ${ktv.rank}` : ''}</span></div>
                  </div>
                  {ktv.repeatPenalty > 0 && (
                    <p className="mb-3 inline-block text-xs font-bold text-[var(--amber)] bg-[var(--amber-2)] px-3 py-1.5 rounded-lg">
                      ↺ Lỗi lặp: {ktv.repeats.map((r: any) => `${r.label} ×${r.times}`).join(', ')} — trừ thêm {fmtNum(ktv.repeatPenalty)}đ
                    </p>
                  )}
                  <div className="mt-auto pt-3 border-t border-[var(--line)] text-sm mb-4">
                    <span className="text-[var(--muted)]">Quỹ nội bộ phải đóng </span>
                    <strong className={ktv.hasData === false ? 'text-[var(--muted)]' : (ktv.fundDue === 0 ? 'text-[var(--green)]' : 'text-[var(--rust)]')}>
                      {ktv.hasData === false ? '—' : fmtMoney(ktv.fundDue)}
                    </strong>
                    <span className="text-[var(--muted)]">{ktv.exemptPct > 0 ? ` (đã miễn ${ktv.exemptPct}%)` : ' — không được miễn'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 h-11 px-4 rounded-xl font-bold btn-danger" onClick={() => logic.openSheet('deduct', ktv.name, ktv.code, ktv.score)}>Trừ điểm</button>
                    <button className="flex-1 h-11 px-4 rounded-xl font-bold btn-ghost" onClick={() => logic.openSheet('history', ktv.name, ktv.code)}>Lịch sử</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Bottom Sheet Overlay */}
      <AnimatePresence>
        {logic.sheetState.isOpen && (
          <div className="fixed inset-0 z-50 flex justify-center items-end md:items-center bg-black/40 backdrop-blur-sm p-0 md:p-6" onClick={(e) => {
            if (e.target === e.currentTarget) logic.closeSheet();
          }}>
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[var(--surface)] w-full max-w-2xl max-h-[92vh] flex flex-col rounded-t-[26px] md:rounded-[26px] overflow-hidden shadow-2xl"
            >
              {/* Sheet Header */}
              <div className="p-5 border-b border-[var(--line)] flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    {logic.sheetState.type === 'deduct' ? 'Trừ điểm' : 
                     logic.sheetState.type === 'unlock' ? 'Mở khóa tài khoản' :
                     logic.sheetState.type === 'settings' ? 'Cài đặt tiêu chí chấm điểm' : 'Lịch sử điểm'}
                  </h2>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    {logic.sheetState.type === 'settings'
                      ? 'Quy chế KTV Loại D · sửa nội dung và điểm trừ'
                      : logic.sheetState.code + ' · ' + logic.sheetState.person}
                  </p>
                </div>
                <button onClick={logic.closeSheet} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100">
                  <X size={20} />
                </button>
              </div>

              {/* Sheet Body */}
              <div className="flex-1 overflow-y-auto p-5 pb-8">
                {logic.sheetState.type === 'deduct' && (
                  <>
                    <div className="bg-[var(--surface-soft)] p-3.5 rounded-2xl mb-5">
                      {/* Chọn ngày bằng LỊCH giống lịch KTV xem ở modal Điểm Office:
                          ô ngày kiêm nút mở lịch, lịch tô màu xanh / đỏ / xám và khoá
                          sẵn ngày không chọn được. Trước đây là ô chọn ngày của trình
                          duyệt — ngày nào cũng trắng như nhau, bấm trúng ngày KTV nghỉ
                          rồi mới bị báo đỏ. */}
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-xs text-[var(--muted)]">Ngày vi phạm</label>
                        <button
                          onClick={() => logic.setShowCalendar(!logic.showCalendar)}
                          className={`h-10 px-4 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors ${
                            logic.showCalendar
                              ? 'bg-indigo-600 text-white shadow-md'
                              : 'bg-white border border-[var(--line)] text-slate-700'
                          }`}
                        >
                          {fmtDayFull(logic.sheetState.workDate)}
                          <CalendarDays size={16} className={logic.showCalendar ? 'text-white' : 'text-indigo-500'} />
                        </button>
                      </div>

                      {logic.showCalendar && (
                        <DeductCalendar
                          month={logic.calendarMonth}
                          days={logic.calendarDays}
                          loading={logic.calendarLoading}
                          today={logic.today}
                          selected={logic.sheetState.workDate}
                          canPickOld={logic.canPickOld}
                          onPrev={() => logic.changeCalendarMonth(-1)}
                          onNext={() => logic.changeCalendarMonth(1)}
                          onPick={logic.pickCalendarDay}
                          onToday={logic.pickToday}
                        />
                      )}

                      <p className="text-xs text-[var(--muted)] mt-2">
                        {logic.canPickOld
                          ? 'Bạn là Quản lý — chọn được mọi ngày đã qua.'
                          : 'Lễ tân chỉ trừ được hôm nay và hôm qua.'}
                        {' '}Ngày xám là ngày KTV không đi làm, không chọn được.
                      </p>

                      {/* Ngày đó KTV có đi làm không — server xét cả chấm công lẫn
                          lịch đăng ký. Báo NGAY ở đây, đừng để tích xong 5 lỗi và
                          chụp ảnh rồi mới bị từ chối lúc bấm gửi. */}
                      {logic.workday && (
                        <div className={`mt-3 p-3 rounded-2xl border text-xs font-bold ${
                          logic.blockedNotWorkday
                            ? 'bg-[var(--rust-2)] border-[var(--rust)]/30 text-[var(--rust)]'
                            : 'bg-[var(--surface-soft)] border-[var(--line)] text-[var(--muted)]'
                        }`}>
                          {logic.blockedNotWorkday ? '⛔ ' : '✓ '}{logic.workday.label}
                          {logic.blockedNotWorkday && (
                            <p className="font-medium mt-1">{logic.workday.reason}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {(() => {
                      // Điểm ngày này = 100 trừ những gì ĐÃ trừ trước đó, rồi trừ tiếp phần đang tích.
                      const already = logic.existingHits.reduce((a: number, h: any) => a + h.points, 0);
                      const current = Math.max(0, 100 - already);
                      const after = Math.max(0, current - logic.totalPoints);
                      return (
                        <div className="bg-[var(--green-2)] p-4 rounded-2xl mb-6">
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="block text-xs text-[var(--muted)]">Điểm ngày này</span>
                              <strong className="text-2xl tracking-tight">{fmtNum(current)}</strong>
                            </div>
                            <div className="text-right">
                              <span className="block text-xs text-[var(--muted)]">Sau khi trừ</span>
                              <strong className={`text-2xl tracking-tight ${logic.totalPoints > 0 ? 'text-[var(--rust)]' : ''}`}>
                                {fmtNum(after)}
                              </strong>
                            </div>
                          </div>
                          {already > 0 && (
                            <p className="text-xs text-[var(--muted)] mt-2 pt-2 border-t border-white/60">
                              Ngày này đã bị trừ {fmtNum(already)}đ ({logic.existingHits.length} lỗi) — các lỗi đó đã khóa, mỗi lỗi chỉ trừ 1 lần/ngày.
                            </p>
                          )}
                          {logic.existingLoading && (
                            <p className="text-xs text-[var(--muted)] mt-2">Đang kiểm tra lỗi đã trừ của ngày này…</p>
                          )}
                        </div>
                      );
                    })()}

                    {logic.criteriaGroups.length === 0 && (
                      <p className="py-6 text-center text-[var(--muted)] text-sm">Đang tải danh sách tiêu chí…</p>
                    )}

                    {logic.criteriaGroups.map((group: any) => (
                      <div key={group.grp} className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-xs font-bold uppercase tracking-widest">{group.label}</h3>
                          <span className="text-xs text-[var(--muted)]">Tối đa {fmtNum(group.max)} điểm</span>
                        </div>
                        <div className="border-t border-[var(--line)]">
                          {group.items.map((item: any) => {
                            const done = logic.existingHits.find((h: any) => h.criteriaId === item.id);
                            const isChecked = !!done || logic.sheetState.selectedIds.includes(item.id);
                            // Chỉ lỗi ĐANG tích (chưa trừ trước đó) mới mở khung ảnh riêng.
                            const picking = !done && logic.sheetState.selectedIds.includes(item.id);
                            const mine: string[] = logic.photosOf(item.id);
                            return (
                              <div key={item.id} className="border-b border-[var(--line)]">
                                {/* Ô ảnh phải nằm NGOÀI <label>: đặt trong label thì bấm
                                    "Thêm ảnh" sẽ gạt luôn dấu tích của chính lỗi đó. */}
                                <label
                                  className={`flex items-center gap-3 py-3 ${done ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="w-5 h-5 accent-[var(--rust)] shrink-0"
                                    checked={isChecked}
                                    disabled={!!done}
                                    onChange={() => logic.toggleCriteria(item.id)}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <strong className="block text-sm font-semibold">{item.label}</strong>
                                    {done ? (
                                      <small className="block text-[11px] text-[var(--muted)] mt-0.5">
                                        Đã trừ lúc {new Date(done.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} bởi {done.byName}
                                        {done.photoCount > 0 ? ` · ${done.photoCount} ảnh` : ''}
                                      </small>
                                    ) : item.requiresPhoto && (
                                      <small className="inline-block text-[10px] font-bold text-[var(--amber)] bg-[var(--amber-2)] px-2 py-0.5 rounded mt-1">CẦN ẢNH</small>
                                    )}
                                  </div>
                                  <span className="font-bold text-[var(--rust)] shrink-0">−{fmtNum(item.points)}</span>
                                </label>

                                {picking && (
                                  <div className="pb-3 pl-8">
                                    <div className="flex gap-2 flex-wrap items-center">
                                      <label className="h-[46px] px-3 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--surface-soft)] flex items-center gap-2 cursor-pointer text-xs font-bold text-[var(--green)] hover:border-[var(--green)]">
                                        <ImageIcon size={14} /> Ảnh cho lỗi này
                                        <input
                                          type="file" accept="image/*" multiple capture="environment" className="hidden"
                                          onChange={e => { logic.addPhotosFor(item.id, e.target.files); e.target.value = ''; }}
                                        />
                                      </label>
                                      {mine.map((src: string, i: number) => (
                                        <div key={i} className="relative w-[46px] h-[46px] rounded-xl overflow-hidden border border-[var(--line)]">
                                          <img src={src} alt={`${item.label} — ảnh ${i + 1}`} className="w-full h-full object-cover" />
                                          <button
                                            onClick={() => logic.removePhotoFor(item.id, i)}
                                            aria-label={`Xóa ảnh ${i + 1} của ${item.label}`}
                                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[var(--rust)] text-white text-[10px] flex items-center justify-center"
                                          >✕</button>
                                        </div>
                                      ))}
                                    </div>
                                    <p className={`text-[11px] mt-1.5 ${item.requiresPhoto && mine.length === 0 ? 'text-[var(--rust)] font-bold' : 'text-[var(--muted)]'}`}>
                                      {item.requiresPhoto && mine.length === 0
                                        ? 'Lỗi này bắt buộc phải có ảnh riêng.'
                                        : `${mine.length}/${logic.maxPhotos} ảnh của riêng lỗi này`}
                                    </p>

                                    {/* Ghi chú cũng của RIÊNG lỗi này. Một ô dùng
                                        chung thì câu giải thích bị ghi y hệt vào
                                        mọi lỗi, KTV đọc không biết nói về cái nào. */}
                                    <textarea
                                      value={logic.noteOf(item.id)}
                                      onChange={e => logic.setNoteFor(item.id, e.target.value)}
                                      placeholder={`Ghi chú cho lỗi "${item.label}" — ví dụ: quên bật app tới 19:30`}
                                      rows={2}
                                      className="w-full mt-2 p-2.5 rounded-xl border border-[var(--line)] focus:outline-none focus:ring-2 focus:ring-[var(--green)]/20 text-xs"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Ảnh minh chứng gắn ngay dưới từng lỗi ở trên, không còn rổ
                        dùng chung. Ở đây chỉ nhắc lại lỗi nào còn thiếu ảnh. */}
                    <div className="border-t border-[var(--line)] pt-5">
                      {logic.missingPhotoFor.length > 0 && (
                        <div className="mb-4 p-3 rounded-2xl bg-[var(--amber-2)] border border-[var(--amber)]/30">
                          <p className="text-xs font-bold text-[var(--amber)]">
                            Còn thiếu ảnh minh chứng riêng cho: {logic.missingPhotoFor.map((c: any) => c.label).join(', ')}.
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-[var(--muted)]">
                        Ảnh và ghi chú gắn ngay dưới từng lỗi ở trên — mỗi lỗi một
                        bằng chứng riêng, để KTV đọc là biết câu đó nói về lỗi nào.
                      </p>
                    </div>
                  </>
                )}

                {logic.sheetState.type === 'unlock' && (
                  <>
                    <div className="bg-[var(--rust-2)] text-[var(--rust)] p-4 rounded-2xl mb-5 text-sm">
                      <strong className="block mb-1">Lý do bị khóa</strong>
                      {logic.unlockInfo
                        ? (logic.unlockInfo.lockReason || 'Không tìm thấy ghi chú lý do khóa.')
                        : 'Đang tải…'}
                      {logic.unlockInfo?.lockDate && (
                        <><br/><span className="opacity-75 text-xs">
                          Khóa ngày {new Date(logic.unlockInfo.lockDate).toLocaleDateString('vi-VN')}
                        </span></>
                      )}
                    </div>

                    {/* Phí kích hoạt lại: mức trong cài đặt là SÀN, thu cao hơn được,
                        thấp hơn thì server chặn. Cần gạt tắt thì không hiện ô này. */}
                    {logic.unlockInfo?.feeEnabled && (
                      <div className="mb-5">
                        <label className="block text-sm font-bold mb-2">Phí kích hoạt lại</label>
                        <div className="relative">
                          <input
                            type="number"
                            min={logic.unlockInfo.feeMin}
                            step={50000}
                            value={logic.unlockFee}
                            onChange={e => logic.setUnlockFee(Number(e.target.value))}
                            className="w-full p-4 pr-14 rounded-2xl border border-[var(--line)] font-bold focus:outline-none focus:ring-2 focus:ring-[var(--green)]/20"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted)] font-bold">đ</span>
                        </div>
                        <p className={`text-xs mt-1.5 ${logic.unlockFee < logic.unlockInfo.feeMin ? 'text-[var(--rust)] font-bold' : 'text-[var(--muted)]'}`}>
                          {logic.unlockFee < logic.unlockInfo.feeMin
                            ? `Không được thấp hơn mức tối thiểu ${logic.unlockInfo.feeMin.toLocaleString('vi-VN')}đ`
                            : `Mức tối thiểu ${logic.unlockInfo.feeMin.toLocaleString('vi-VN')}đ — có thể thu cao hơn.`}
                        </p>
                      </div>
                    )}

                    <div className="mt-5">
                      <label className="block text-sm font-bold mb-2">Lý do mở khóa <span className="text-[var(--rust)]">*</span></label>
                      <textarea
                        className="w-full min-h-[120px] p-4 rounded-2xl border border-[var(--line)] focus:outline-none focus:ring-2 focus:ring-[var(--green)]/20"
                        placeholder="Ví dụ: KTV đã bổ sung lịch làm việc và được quản lý xác nhận."
                        value={logic.unlockReason}
                        onChange={e => logic.setUnlockReason(e.target.value)}
                      ></textarea>
                    </div>
                  </>
                )}

                {logic.sheetState.type === 'history' && (
                  <>
                    {/* Tháng của sheet tách khỏi tháng bảng danh sách — tra ngược tháng cũ
                        của một KTV mà không phải đóng sheet rồi đổi tháng cả trang. */}
                    <div className="mb-5">
                      <MonthPicker
                        value={logic.detailMonth}
                        max={logic.thisMonthStr}
                        onPick={logic.setDetailMonth}
                        onStep={logic.changeDetailMonth}
                      />
                    </div>

                    {logic.detailLoading && (
                      <p className="py-10 text-center text-[var(--muted)]">Đang tải dữ liệu…</p>
                    )}

                    {!logic.detailLoading && !logic.detail && (
                      <p className="py-10 text-center text-[var(--muted)]">Không tải được dữ liệu của KTV này.</p>
                    )}

                    {!logic.detailLoading && logic.detail && (() => {
                      const o = logic.detail.office;
                      const hrs = logic.detail.hours;
                      return (
                        <>
                          {/* `hasData === false` là CHƯA CÓ NGÀY CÔNG, không phải điểm tuyệt
                              đối. Thẻ KTV ở danh sách đã hiện "Chưa có dữ liệu" từ lâu; sheet
                              này trước đây vẫn hiện 100 điểm và quỹ 0đ, tức hai chỗ nói hai
                              điều khác nhau về cùng một người. */}
                          <div className="grid grid-cols-2 gap-3 mb-5">
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl">
                              <span className="block text-xs text-[var(--muted)]">Điểm tháng {Number(logic.detailMonth.slice(5))}</span>
                              <strong className={`text-lg ${o.hasData === false ? 'text-[var(--muted)]' : ''}`}>
                                {o.hasData === false ? 'Chưa có dữ liệu' : `${fmtNum(o.score)} điểm`}
                              </strong>
                            </div>
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl">
                              <span className="block text-xs text-[var(--muted)]">
                                Quỹ phải đóng{o.hasData !== false && o.exemptPct > 0 ? ` · miễn ${o.exemptPct}%` : ''}
                              </span>
                              <strong className={`text-lg ${
                                o.hasData === false ? 'text-[var(--muted)]' : (o.fundDue === 0 ? 'text-[var(--green)]' : 'text-[var(--rust)]')
                              }`}>
                                {o.hasData === false ? '—' : fmtMoney(o.fundDue)}
                              </strong>
                            </div>
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl">
                              <span className="block text-xs text-[var(--muted)]">Ngày đi làm</span>
                              <strong className="text-lg">
                                {o.workDays} ngày
                                {o.workDays > 0 && (
                                  <span className="text-xs font-bold text-[var(--muted)] ml-1.5">{o.cleanDays} ngày sạch</span>
                                )}
                              </strong>
                            </div>
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl">
                              <span className="block text-xs text-[var(--muted)]">Giờ tích lũy</span>
                              <strong className="text-lg">{fmtHours(hrs.total)}</strong>
                            </div>
                          </div>

                          <div className="flex gap-1 border-b border-[var(--line)] mb-5">
                            <button
                              onClick={() => logic.setHistoryTab('office')}
                              className={`px-4 py-3 font-bold text-sm border-b-2 -mb-px ${logic.historyTab === 'office' ? 'border-[var(--green)] text-[var(--green)]' : 'border-transparent text-[var(--muted)]'}`}
                            >Điểm Office</button>
                            <button
                              onClick={() => logic.setHistoryTab('hours')}
                              className={`px-4 py-3 font-bold text-sm border-b-2 -mb-px ${logic.historyTab === 'hours' ? 'border-[var(--green)] text-[var(--green)]' : 'border-transparent text-[var(--muted)]'}`}
                            >Giờ tích lũy</button>
                          </div>

                          {logic.historyTab === 'office' && o.hasData === false && (
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl mb-5 text-sm">
                              <p className="font-bold mb-1">Chưa có ngày công nào trong tháng này</p>
                              <p className="text-xs text-[var(--muted)] leading-relaxed">
                                Điểm tháng là trung bình các ngày đi làm, chưa đi làm buổi nào thì chưa có
                                mẫu số để tính — không phải đạt 100 điểm. Mức quỹ cũng chưa xét được.
                              </p>
                            </div>
                          )}

                          {logic.historyTab === 'office' && o.hasData !== false && (
                            <>
                              {/* Bóc từng bước ra để KTV không thắc mắc vì sao ra con số này */}
                              <div className="bg-[var(--surface-soft)] p-4 rounded-2xl mb-5 text-sm">
                                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Điểm từng ngày · tháng {Number(logic.detailMonth.slice(5))}</p>
                                <p className="text-xs text-[var(--muted)] mb-3">Mỗi ngày đi làm bắt đầu từ 100đ, trừ dần theo lỗi trong ngày đó.</p>
                                {o.days.length === 0 ? (
                                  <p className="py-3 text-xs text-[var(--muted)]">Chưa có ngày đi làm nào trong tháng.</p>
                                ) : o.days.map((d: any) => (
                                  <div key={d.workDate} className="flex justify-between items-baseline py-1.5 border-b border-[var(--line)]">
                                    <span className="flex items-baseline gap-2">
                                      {/* Chấm màu để quét mắt qua cả tháng là thấy ngay ngày nào sạch. */}
                                      <i className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        d.hits.length === 0 ? 'bg-[var(--green)]' : 'bg-[var(--rust)]'
                                      }`} />
                                      {fmtDate(d.workDate)}
                                      <span className="text-xs text-[var(--muted)]">
                                        {d.hits.length === 0 ? 'không vi phạm' : `${d.hits.length} lỗi`}
                                      </span>
                                    </span>
                                    <b className={d.hits.length === 0 ? 'text-[var(--green)]' : 'text-[var(--rust)]'}>{fmtNum(d.dayScore)}đ</b>
                                  </div>
                                ))}
                                <div className="flex justify-between py-2 mt-1">
                                  <span>Trung bình {o.workDays} ngày đi làm</span><b>{fmtNum(o.avg)}đ</b>
                                </div>
                                {o.repeats.length > 0 ? (
                                  <>
                                    <div className="flex justify-between py-1.5"><span>Phạt lỗi lặp ≥3 lần/tháng</span><b className="text-[var(--rust)]">−{fmtNum(o.repeatPenalty)}đ</b></div>
                                    {o.repeats.map((r: any) => (
                                      <div key={r.criteriaId} className="flex justify-between py-1 pl-4 text-xs text-[var(--muted)]">
                                        <span>{r.label} — lặp {r.times} lần</span><b className="text-[var(--rust)]">−{fmtNum(r.points)}đ</b>
                                      </div>
                                    ))}
                                  </>
                                ) : (
                                  <div className="flex justify-between py-1 pl-4 text-xs text-[var(--muted)]"><span>Không có lỗi nào lặp từ 3 lần</span><b>−0đ</b></div>
                                )}
                                <div className="flex justify-between py-2.5 border-t-2 border-[var(--line)] mt-2 text-base font-bold">
                                  <span>Điểm tháng</span><b>{fmtNum(o.score)}đ</b>
                                </div>
                                <div className="flex justify-between py-1 text-xs">
                                  <span className="text-[var(--muted)]">Quỹ nội bộ còn phải đóng{o.exemptPct > 0 ? ` (đã miễn ${o.exemptPct}%)` : ''}</span>
                                  <b className={o.fundDue === 0 ? 'text-[var(--green)]' : 'text-[var(--rust)]'}>{fmtMoney(o.fundDue)}</b>
                                </div>
                                <p className="text-xs text-[var(--muted)] mt-3 pt-3 border-t border-[var(--line)] leading-relaxed">
                                  Mỗi ngày đi làm bắt đầu từ 100 điểm. Điểm tháng là trung bình các ngày đi làm trong tháng — lỗi của tháng trước không tính sang tháng sau.
                                </p>
                              </div>

                            </>
                          )}

                          {/* Timeline chỉ liệt kê ngày CÓ phiếu (còn hiệu lực hoặc đã thu hồi)
                              — bảng phía trên đã liệt kê đủ mọi ngày. Vẫn hiện khi chưa có
                              ngày công, vì có thể tồn tại phiếu đã bị thu hồi. */}
                          {logic.historyTab === 'office' && <ViolationTimeline office={o} logic={logic} />}

                          {logic.historyTab === 'hours' && (
                            hrs.rows.length === 0 ? (
                              <p className="py-8 text-center text-[var(--muted)] text-sm">Tháng này chưa có phát sinh giờ nào.</p>
                            ) : (
                              <>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm border-collapse">
                                    <thead>
                                      <tr className="text-[10px] uppercase tracking-widest text-[var(--muted)]">
                                        <th className="text-left pb-2 pr-3">Ngày</th>
                                        <th className="text-left pb-2 pr-3">Nội dung</th>
                                        <th className="text-right pb-2 pr-3 whitespace-nowrap">Cộng</th>
                                        <th className="text-right pb-2 pr-3 whitespace-nowrap">Trừ</th>
                                        <th className="text-right pb-2 whitespace-nowrap">Còn lại</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {hrs.rows.map((r: any) => (
                                        <tr key={r.id} className="border-t border-[var(--line)]">
                                          <td className="py-2.5 pr-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                                          <td className="py-2.5 pr-3">
                                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${r.penaltyLabel ? 'bg-[var(--rust-2)] text-[var(--rust)] border-[var(--rust)]' : 'bg-[var(--green-2)] text-[var(--green)] border-[var(--green)]'}`}>
                                              {r.penaltyLabel || 'Giờ làm khách'}
                                            </span>
                                            {/* Mã đơn quan trọng hơn ghi chú — đối chiếu ngược lại đơn hàng khi KTV thắc mắc. */}
                                            {r.orderCode && (
                                              <p className="text-xs font-mono font-bold text-[var(--ink)] mt-1" title={r.bookingId || ''}>{r.orderCode}</p>
                                            )}
                                            {r.note && <p className="text-xs text-[var(--muted)] mt-0.5">{r.note}</p>}
                                          </td>
                                          <td className="py-2.5 pr-3 text-right whitespace-nowrap text-[var(--green)] font-bold">{r.earned ? '+' + fmtHours(r.earned) : '—'}</td>
                                          <td className="py-2.5 pr-3 text-right whitespace-nowrap text-[var(--rust)] font-bold">{r.penalty ? '−' + fmtHours(r.penalty) : '—'}</td>
                                          <td className="py-2.5 text-right whitespace-nowrap font-bold">{fmtHours(r.balance)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <p className="text-xs text-[var(--muted)] mt-4 leading-relaxed">
                                  Giờ tích lũy quyết định <b>thứ tự nhận tua</b> trong ngày — KTV có tổng giờ cao hơn được xếp tua trước.
                                  Không liên quan tới điểm Office (dùng cho miễn quỹ nội bộ).
                                </p>
                              </>
                            )
                          )}
                        </>
                      );
                    })()}
                  </>
                )}

                {logic.sheetState.type === 'settings' && <CriteriaSettings logic={logic} />}
              </div>

              {/* Sheet Footer */}
              <div className="p-4 border-t border-[var(--line)] flex gap-3 bg-white/95">
                {logic.sheetState.type === 'deduct' && (
                  <>
                    <button className="flex-none w-24 h-12 rounded-xl font-bold btn-ghost" onClick={logic.closeSheet} disabled={logic.submitting}>Hủy</button>
                    <button
                      className="flex-1 h-12 rounded-xl font-bold btn-primary disabled:opacity-50"
                      disabled={!logic.canSubmit || logic.submitting}
                      onClick={logic.submitDeduct}
                    >
                      {logic.submitting ? 'Đang lưu…'
                        : logic.blockedNotWorkday ? 'Ngày này KTV không đi làm'
                        : logic.sheetState.selectedIds.length === 0 ? 'Chưa chọn lỗi nào'
                        : logic.missingPhotoFor.length > 0 ? `Cần ảnh riêng cho ${logic.missingPhotoFor.length} lỗi`
                        : `Xác nhận trừ ${fmtNum(logic.totalPoints)} điểm`}
                    </button>
                  </>
                )}
                {logic.sheetState.type === 'unlock' && (
                  <>
                    <button className="flex-none w-24 h-12 rounded-xl font-bold btn-ghost" onClick={logic.closeSheet}>Hủy</button>
                    <button
                      className="flex-1 h-12 rounded-xl font-bold btn-primary disabled:opacity-50"
                      disabled={!logic.canUnlock || logic.submitting}
                      onClick={logic.submitUnlock}
                    >
                      {logic.submitting ? 'Đang mở khóa…'
                        : !logic.unlockReason.trim() ? 'Nhập lý do mở khóa'
                        : (logic.unlockInfo?.feeEnabled && logic.unlockFee < logic.unlockInfo.feeMin) ? 'Phí thấp hơn mức tối thiểu'
                        : logic.unlockInfo?.feeEnabled
                          ? `Mở khóa & thu ${logic.unlockFee.toLocaleString('vi-VN')}đ`
                          : 'Xác nhận mở khóa'}
                    </button>
                  </>
                )}
                {(logic.sheetState.type === 'history' || logic.sheetState.type === 'settings') && (
                  <button className="flex-1 h-12 rounded-xl font-bold btn-primary" onClick={logic.closeSheet}>Đóng</button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </AppLayout>
  );
};

export default AdminKtvOfficePage;
