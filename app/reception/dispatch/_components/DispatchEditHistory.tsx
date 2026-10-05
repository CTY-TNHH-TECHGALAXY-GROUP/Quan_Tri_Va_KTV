import React from 'react';
import type { ServiceBlock } from '../types';
import type { DispatchEditEntry } from '@/lib/dispatch-edit-history';

const fields: Record<string, string> = {
  startTime: 'Giờ bắt đầu', endTime: 'Giờ kết thúc', duration: 'Số phút',
  plannedStartAt: 'Bắt đầu dự kiến', plannedEndAt: 'Kết thúc dự kiến', actualStartTime: 'Bắt đầu thực tế',
  actualEndTime: 'Kết thúc thực tế', serviceNameForKtv: 'Tên dịch vụ riêng', displayName: 'Tên dịch vụ chung',
  ktvId: 'Nhân viên', sequenceSlot: 'Lượt', voided: 'Hủy lượt'
};

const actions: Record<string, string> = {
  DRAFT: 'Lưu nháp', DISPATCH: 'Điều phối', ASSIGN_B: 'Gán KTV làm tiếp',
  EDIT_ACTUAL_TIME: 'Sửa giờ thực tế', ENABLE_SEQUENTIAL: 'Thêm làm tiếp',
  FINISH_AFTER_A: 'Hoàn thành lượt đầu', UPDATE: 'Cập nhật'
};

const actionBadgeStyles: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  DISPATCH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ASSIGN_B: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  EDIT_ACTUAL_TIME: 'bg-amber-50 text-amber-700 border-amber-200',
  ENABLE_SEQUENTIAL: 'bg-blue-50 text-blue-700 border-blue-200',
  FINISH_AFTER_A: 'bg-teal-50 text-teal-700 border-teal-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
};

const valueText = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Trống';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
    return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return String(value);
};

export function DispatchEditHistory({ services }: { services: ServiceBlock[] }) {
  const entries = services.flatMap(service => ((service.options?.dispatchHistory || []) as DispatchEditEntry[])
    .map(entry => ({ ...entry, serviceId: service.id, serviceName: service.options?.displayName || service.serviceName })));

  return (
    <details className="group rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 text-sm shadow-sm transition-all">
      <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-800 list-none select-none">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm">Lịch sử sửa giờ / tên dịch vụ</span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-black text-indigo-700 border border-indigo-100">
            {entries.length}
          </span>
        </div>
        <span className="text-slate-400 transition-transform duration-200 group-open:rotate-180 text-xs">
          ▼
        </span>
      </summary>

      {entries.length ? (
        <ol className="mt-3.5 space-y-2.5">
          {entries.sort((a, b) => b.at.localeCompare(a.at)).map((entry, index) => {
            const hasServiceNameChange = entry.changes.some(c => c.field === 'serviceNameForKtv' || c.field === 'displayName');
            return (
              <li key={`${entry.serviceId}-${entry.revision}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 sm:p-3 space-y-2 hover:border-slate-200 transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-black text-slate-700">
                      Bản {entry.revision}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${actionBadgeStyles[entry.action] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                      {actions[entry.action] || entry.action}
                    </span>
                  </div>
                  {hasServiceNameChange && (
                    <span className="font-bold text-indigo-900 text-xs bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      Đổi tên: {entry.serviceName}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{new Date(entry.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                  <span>·</span>
                  <span className="font-medium text-slate-700">{entry.actor?.name || entry.actor?.id || 'Không rõ người sửa'}</span>
                </div>
                <ul className="mt-1 space-y-1.5">
                  {entry.changes.map((change, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/60 bg-white px-2.5 py-1.5 text-xs shadow-xs">
                      {change.employeeId && <strong className="text-slate-800 shrink-0 font-bold">{change.employeeId} · </strong>}
                      <span className="font-semibold text-slate-600 shrink-0">{fields[change.field] || change.field}:</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 line-through shrink-0">{valueText(change.before)}</span>
                      <span className="text-slate-400 font-bold shrink-0">→</span>
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-100 shrink-0">{valueText(change.after)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-slate-500 italic">Chưa có lịch sử thay đổi được ghi nhận.</p>
      )}
    </details>
  );
}
