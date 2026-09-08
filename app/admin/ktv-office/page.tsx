'use client';

import React from 'react';
import { useAdminKtvOfficeLogic } from './AdminKtvOffice.logic';
import { Search, ChevronLeft, ChevronRight, X, Image as ImageIcon, Pencil, Undo2, Trash2, Plus, SlidersHorizontal, Timer } from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { AppLayout } from '@/components/layout/AppLayout';
import { fmtHours } from '@/lib/hours-format';

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
          {hit.byName} · {new Date(hit.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
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
          {logic.isManager && (
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
                      <div><strong className="block text-xl">{fmtNum(ktv.score)} điểm</strong><span className="text-[var(--muted)] text-xs">Điểm tháng {logic.month} · {ktv.workDays} ngày làm</span></div>
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
                    <div><strong className="block text-xl">{fmtNum(ktv.score)} điểm</strong><span className="text-[var(--muted)] text-xs">Điểm tháng {logic.month} · {ktv.workDays} ngày làm</span></div>
                    <div><strong className="block text-xl">{fmtHours(ktv.hours)}</strong><span className="text-[var(--muted)] text-xs">Giờ tích lũy{ktv.rank ? ` · hạng ${ktv.rank}` : ''}</span></div>
                  </div>
                  {ktv.repeatPenalty > 0 && (
                    <p className="mb-3 inline-block text-xs font-bold text-[var(--amber)] bg-[var(--amber-2)] px-3 py-1.5 rounded-lg">
                      ↺ Lỗi lặp: {ktv.repeats.map((r: any) => `${r.label} ×${r.times}`).join(', ')} — trừ thêm {fmtNum(ktv.repeatPenalty)}đ
                    </p>
                  )}
                  <div className="mt-auto pt-3 border-t border-[var(--line)] text-sm mb-4">
                    <span className="text-[var(--muted)]">Quỹ nội bộ phải đóng </span>
                    <strong className={ktv.fundDue === 0 ? 'text-[var(--green)]' : 'text-[var(--rust)]'}>{fmtMoney(ktv.fundDue)}</strong>
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
                      <label className="block text-xs text-[var(--muted)] mb-2">Ngày vi phạm</label>
                      <div className="flex gap-2 flex-wrap">
                        {/* Ngày làm việc do server chốt theo mốc cắt 06:00 — sau nửa đêm
                            "Hôm nay" vẫn là ca đang chạy, không nhảy sang ngày lịch mới. */}
                        <button
                          onClick={() => logic.changeWorkDate(logic.today)}
                          className={`h-11 px-4 rounded-xl font-bold text-sm ${logic.sheetState.workDate === logic.today ? 'btn-primary' : 'bg-white border border-[var(--line)]'}`}
                        >Hôm nay</button>
                        <button
                          onClick={() => logic.changeWorkDate(logic.yesterday)}
                          className={`h-11 px-4 rounded-xl font-bold text-sm ${logic.sheetState.workDate === logic.yesterday ? 'btn-primary' : 'bg-white border border-[var(--line)]'}`}
                        >Hôm qua</button>
                        <input
                          type="date"
                          max={logic.today}
                          value={logic.sheetState.workDate}
                          onChange={e => logic.changeWorkDate(e.target.value)}
                          className="h-11 px-3 rounded-xl border border-[var(--line)] bg-white text-sm font-bold"
                        />
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-2">Lễ tân chỉ trừ được hôm nay và hôm qua. Quản lý trừ được mọi ngày.</p>
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
                            return (
                              <label
                                key={item.id}
                                className={`flex items-center gap-3 py-3 border-b border-[var(--line)] ${done ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
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
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Ảnh minh chứng */}
                    <div className="border-t border-[var(--line)] pt-5">
                      <div className="flex items-baseline justify-between mb-1">
                        <h3 className="text-sm font-bold">Ảnh minh chứng</h3>
                        {logic.needPhoto
                          ? <span className="text-[10px] font-bold text-[var(--amber)] bg-[var(--amber-2)] px-2 py-0.5 rounded">BẮT BUỘC</span>
                          : <span className="text-xs text-[var(--muted)]">(tùy chọn)</span>}
                      </div>
                      <p className="text-xs text-[var(--muted)] mb-3">
                        {logic.needPhoto
                          ? 'Lỗi bạn chọn cần ảnh để KTV không khiếu nại được.'
                          : 'Nên có ảnh nếu lỗi dễ gây tranh cãi.'}
                      </p>

                      <div className="flex gap-2 flex-wrap items-center">
                        <label className="h-[54px] px-4 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--surface-soft)] flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--green)] hover:border-[var(--green)]">
                          <ImageIcon size={16} /> Thêm ảnh
                          <input
                            type="file" accept="image/*" multiple capture="environment" className="hidden"
                            onChange={e => { logic.addPhotos(e.target.files); e.target.value = ''; }}
                          />
                        </label>
                        {logic.sheetState.photos.map((src: string, i: number) => (
                          <div key={i} className="relative w-[54px] h-[54px] rounded-xl overflow-hidden border border-[var(--line)]">
                            <img src={src} alt={`Minh chứng ${i + 1}`} className="w-full h-full object-cover" />
                            <button
                              onClick={() => logic.removePhoto(i)}
                              aria-label={`Xóa ảnh ${i + 1}`}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-[var(--rust)] text-white text-xs flex items-center justify-center"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-2">{logic.sheetState.photos.length}/{logic.maxPhotos} ảnh</p>

                      <label className="block text-sm font-bold mt-5 mb-2">Ghi chú cho KTV</label>
                      <textarea
                        className="w-full min-h-[80px] p-3 rounded-2xl border border-[var(--line)] focus:outline-none focus:ring-2 focus:ring-[var(--green)]/20 text-sm"
                        placeholder="Ví dụ: Không đeo bảng tên suốt ca chiều."
                        value={logic.sheetState.note}
                        onChange={e => logic.setSheetState(p => ({ ...p, note: e.target.value }))}
                      />
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
                    <div className="flex items-center justify-between gap-3 bg-[var(--surface-soft)] p-2 rounded-2xl mb-5">
                      <button
                        onClick={() => logic.changeDetailMonth(-1)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white"
                        aria-label="Tháng trước"
                      ><ChevronLeft size={20}/></button>
                      <div className="text-center">
                        <span className="block text-[10px] uppercase tracking-widest text-[var(--muted)]">Kỳ xem</span>
                        <input
                          type="month"
                          value={logic.detailMonth}
                          onChange={e => logic.setDetailMonth(e.target.value)}
                          className="bg-transparent font-bold text-sm text-center focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => logic.changeDetailMonth(1)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white"
                        aria-label="Tháng sau"
                      ><ChevronRight size={20}/></button>
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
                          <div className="grid grid-cols-2 gap-3 mb-5">
                            <div className="bg-[var(--surface-soft)] p-4 rounded-2xl">
                              <span className="block text-xs text-[var(--muted)]">Điểm tháng {Number(logic.detailMonth.slice(5))}</span>
                              <strong className="text-lg">{fmtNum(o.score)} điểm</strong>
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

                          {logic.historyTab === 'office' && (
                            <>
                              {/* Bóc từng bước ra để KTV không thắc mắc vì sao ra con số này */}
                              <div className="bg-[var(--surface-soft)] p-4 rounded-2xl mb-5 text-sm">
                                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Điểm từng ngày · tháng {Number(logic.detailMonth.slice(5))}</p>
                                <p className="text-xs text-[var(--muted)] mb-3">Mỗi ngày đi làm bắt đầu từ 100đ, trừ dần theo lỗi trong ngày đó.</p>
                                {o.days.length === 0 ? (
                                  <p className="py-3 text-xs text-[var(--muted)]">Chưa có ngày đi làm nào trong tháng.</p>
                                ) : o.days.map((d: any) => (
                                  <div key={d.workDate} className="flex justify-between items-baseline py-1.5 border-b border-[var(--line)]">
                                    <span>
                                      {fmtDate(d.workDate)}
                                      <span className="text-xs text-[var(--muted)] ml-2">
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

                              {/* Timeline chỉ liệt kê ngày CÓ vi phạm — bảng phía trên đã liệt kê đủ mọi ngày. */}
                              {o.days.filter((d: any) => d.hits.length > 0).length === 0 ? (
                                <p className="py-8 text-center text-[var(--muted)] text-sm">Tháng này chưa có phiếu trừ điểm nào.</p>
                              ) : (
                                <div className="pl-6 border-l-2 border-[var(--line)] ml-2">
                                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] mb-3 -ml-6">Chi tiết vi phạm</p>
                                  {o.days.filter((d: any) => d.hits.length > 0).map((d: any) => (
                                    <div key={d.workDate} className="relative pb-6">
                                      <div className="absolute w-3.5 h-3.5 rounded-full border-2 border-[var(--rust)] bg-white -left-[32px] top-1"></div>
                                      <div className="flex justify-between items-baseline mb-2">
                                        <span className="text-xs text-[var(--muted)]">{fmtDate(d.workDate)}</span>
                                        <b className="text-sm">{fmtNum(d.dayScore)} / 100</b>
                                      </div>
                                      {d.hits.map((h: any) => (
                                        <HitRow key={h.logId} hit={h} logic={logic} />
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}

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
                        : logic.sheetState.selectedIds.length === 0 ? 'Chưa chọn lỗi nào'
                        : logic.needPhoto && logic.sheetState.photos.length === 0 ? 'Cần thêm ảnh minh chứng'
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
