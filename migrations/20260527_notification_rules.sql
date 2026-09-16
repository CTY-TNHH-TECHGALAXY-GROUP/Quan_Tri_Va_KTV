-- =============================================================================
-- Migration: Notification Rules Config
-- Add notification_rules to SystemConfigs for dynamic notification management
-- =============================================================================

INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('notification_rules', '{
  "NEW_ORDER": {
    "label": "Đơn hàng mới (quầy)",
    "icon": "📋",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": false,
    "require_on_shift": true,
    "sound": "quay-don-hang-moi.wav",
    "enabled": true
  },
  "KTV_NEW_ORDER": {
    "label": "Phân đơn cho KTV",
    "icon": "🔔",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": true,
    "sound": "ktv-don-hang-moi.wav",
    "enabled": true
  },
  "REWARD": {
    "label": "Khách thưởng (4-5 sao)",
    "icon": "🎁",
    "allowed_roles": ["admin"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "ktv-nhan-thuong.wav",
    "enabled": true
  },
  "COMPLAINT": {
    "label": "Đánh giá tệ (1-2 sao)",
    "icon": "🚨",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "quay-danh-gia-te.wav",
    "enabled": true
  },
  "ATTENDANCE": {
    "label": "KTV điểm danh",
    "icon": "📍",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "LEAVE_REQUEST": {
    "label": "KTV xin nghỉ",
    "icon": "📋",
    "allowed_roles": ["admin"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "SUDDEN_OFF": {
    "label": "Nghỉ đột xuất (kỷ luật)",
    "icon": "⚠️",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "quay-bao-khan-cap.wav",
    "enabled": true
  },
  "LEAVE_RESPONSE": {
    "label": "Kết quả duyệt nghỉ",
    "icon": "📋",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "SHIFT_CHANGE": {
    "label": "KTV đổi ca",
    "icon": "🔄",
    "allowed_roles": ["admin"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "SHIFT_RESPONSE": {
    "label": "Kết quả duyệt ca",
    "icon": "🔄",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "WATER": {
    "label": "Khách gọi nước",
    "icon": "💧",
    "allowed_roles": ["reception"],
    "include_target_employee": false,
    "require_on_shift": true,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "BUY_MORE": {
    "label": "Khách mua thêm",
    "icon": "✨",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": false,
    "require_on_shift": true,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "EARLY_EXIT": {
    "label": "Khách về sớm",
    "icon": "🏃",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": false,
    "require_on_shift": true,
    "sound": "quay-khach-ve-som.wav",
    "enabled": true
  },
  "SUPPORT": {
    "label": "KTV cần hỗ trợ",
    "icon": "🛠️",
    "allowed_roles": ["reception"],
    "include_target_employee": false,
    "require_on_shift": true,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "EMERGENCY": {
    "label": "Khẩn cấp SOS",
    "icon": "🆘",
    "allowed_roles": ["admin", "reception", "ktv"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "quay-bao-khan-cap.wav",
    "enabled": true
  },
  "WALLET": {
    "label": "Ví tiền (rút/nạp)",
    "icon": "💰",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "KTV_REVIEW": {
    "label": "KTV đánh giá khách",
    "icon": "📝",
    "allowed_roles": ["admin"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  }
}'::jsonb, 'Quy tắc phân luồng thông báo theo loại và vai trò — Admin quản lý từ UI')
ON CONFLICT (key) DO NOTHING;
