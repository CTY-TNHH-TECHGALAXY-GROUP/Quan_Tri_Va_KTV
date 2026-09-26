import type { ServiceBlock } from '../types';
import type { DispatchEditEntry } from '@/lib/dispatch-edit-history';

const fields: Record<string, string> = { startTime: 'Giờ bắt đầu', endTime: 'Giờ kết thúc', duration: 'Số phút',
  plannedStartAt: 'Bắt đầu dự kiến', plannedEndAt: 'Kết thúc dự kiến', actualStartTime: 'Bắt đầu thực tế',
  actualEndTime: 'Kết thúc thực tế', serviceNameForKtv: 'Tên dịch vụ riêng', displayName: 'Tên dịch vụ chung',
  ktvId: 'Nhân viên', sequenceSlot: 'Lượt', voided: 'Hủy lượt' };
const actions: Record<string, string> = { DRAFT: 'Lưu nháp', DISPATCH: 'Điều phối', ASSIGN_B: 'Gán / sửa B',
  EDIT_ACTUAL_TIME: 'Sửa giờ thực tế', ENABLE_SEQUENTIAL: 'Thêm lượt nối tiếp', FINISH_AFTER_A: 'Hoàn thành', UPDATE: 'Cập nhật' };
const valueText = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Trống';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
    return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return String(value);
};
export function DispatchEditHistory({ services }: { services: ServiceBlock[] }) {
  const entries = services.flatMap(service => ((service.options?.dispatchHistory || []) as DispatchEditEntry[])
    .map(entry => ({ ...entry, serviceId: service.id, serviceName: service.options?.displayName || service.serviceName })));
  return <details className="rounded-xl border bg-white p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Lịch sử sửa giờ / tên dịch vụ ({entries.length})</summary>
    {entries.length ? <ol className="mt-3 space-y-3">{entries.sort((a, b) => b.at.localeCompare(a.at)).map((entry, index) =>
      <li key={`${entry.serviceId}-${entry.revision}-${index}`} className="rounded border p-2">
        <p className="font-medium">{entry.serviceName} · Bản {entry.revision} · {actions[entry.action] || entry.action}</p>
        <p className="text-xs text-gray-500">{new Date(entry.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {entry.actor?.name || entry.actor?.id || 'Không rõ người sửa'}</p>
        <ul className="mt-1 space-y-1">{entry.changes.map((change, i) => <li key={i}>
          {change.employeeId && <strong>{change.employeeId} · </strong>}{fields[change.field] || change.field}: {valueText(change.before)} → {valueText(change.after)}
        </li>)}</ul>
      </li>)}</ol> : <p className="mt-2 text-gray-500">Chưa có lịch sử thay đổi được ghi nhận.</p>}
  </details>;
}
