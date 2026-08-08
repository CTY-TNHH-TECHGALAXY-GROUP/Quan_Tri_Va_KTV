import { ModuleId, ModuleDefinition } from './types';

export const MODULES: ModuleDefinition[] = [
  { id: 'dashboard', name: 'Dashboard', group: 'Vận Hành' },
  { id: 'dispatch_board', name: 'Điều Phối & Giám Sát', group: 'Vận Hành' },
  { id: 'staff_notifications', name: 'Thông Báo', group: 'Vận Hành' },
  { id: 'customer_management', name: 'Khách Hàng', group: 'Vận Hành' },
  { id: 'revenue_reports', name: 'Báo Cáo', group: 'Tài Chính & Kế Toán' },
  { id: 'payroll_commissions', name: 'Lương & Hoa Hồng', group: 'Tài Chính & Kế Toán' },
  { id: 'cashbook_supplies', name: 'Sổ Quỹ & Vật Tư', group: 'Tài Chính & Kế Toán' },
  { id: 'finance_management', name: 'Thu Ngân KTV', group: 'Tài Chính & Kế Toán' },
  { id: 'finance_piggy_bank', name: 'Ví Tích Lũy KTV', group: 'Tài Chính & Kế Toán' },
  { id: 'web_booking', name: 'Đơn Đặt Lịch Web', group: 'Vận Hành' },
  { id: 'service_menu', name: 'Menu Dịch Vụ', group: 'Thiết Lập Nội Dung' },
  { id: 'customer_reminders', name: 'Câu Hỏi Khảo Sát', group: 'Thiết Lập Nội Dung' },
  { id: 'role_management', name: 'Phân Quyền', group: 'Hệ Thống' },
  { id: 'employee_management', name: 'Nhân Viên', group: 'Hệ Thống' },
  { id: 'ktv_dashboard', name: 'KTV Dashboard', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_wallet', name: 'Ví & Rút Tiền', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_attendance', name: 'Chấm Công', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_schedule', name: 'Lịch Làm Việc', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_performance', name: 'Hiệu Suất', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_history', name: 'Lịch Sử', group: 'Kỹ Thuật Viên' },
  { id: 'ktv_hub', name: 'Quản Lý KTV', group: 'Vận Hành' },
  { id: 'room_management', name: 'Quản Lý Phòng', group: 'Vận Hành' },
  { id: 'service_handbook', name: 'Sổ Tay Dịch Vụ', group: 'Kỹ Thuật Viên' },
  { id: 'ai_features', name: 'AI Assistant', group: 'Hệ Thống' },
  { id: 'device_management', name: 'Thiết Bị', group: 'Hệ Thống' },
  { id: 'support_tasks_admin', name: 'Giao Việc', group: 'Giao Việc' },
  { id: 'employee_tasks', name: 'Công Việc Của Tôi', group: 'Kỹ Thuật Viên' },
  { id: 'system_settings', name: 'Cài Đặt Hệ Thống', group: 'Hệ Thống' },
  { id: 'settings', name: 'Cài Đặt', group: 'Hệ Thống' },
];

export const SYSTEM_CONFIG = {
  spa_name: 'Ngân Hà Spa',
  spa_address: '123 Đường Ngân Hà, Quận 1, TP. HCM',
  internal_qr_url: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://nganhaspa.vn/internal',
};
