export interface WorkSegment {
  id: string;
  roomId: string | null;
  bedId: string | null;
  startTime: string;
  actualStartTime?: string | null;
  duration: number;
  endTime: string;
  actualEndTime?: string | null;
  feedbackTime?: string | null;
  startPhotoUrl?: string | null;
  handoverPhotoUrl?: string | null; // For legacy compatibility
  handoverPhotoUrls?: string[]; // Multiple handover photos
}

export interface StaffAssignment {
  id: string; // Internal mapping ID
  ktvId: string;
  ktvName: string;
  segments: WorkSegment[];
  noteForKtv: string;
  serviceNameForKtv?: string;
  _calculatedStartTime?: string; // Virtual property for Kanban rendering
}

export interface GuestBlock {
  id: string;
  bookingId: string;
  guestIndex: number;
  guestLabel: string;
  customerName?: string | null;
  gender?: string | null;
  nationality?: string | null;
  bedId?: string | null;
  roomId?: string | null;
  notes?: string | null;
  focusArea?: string | null;
  status: string;
  items?: ServiceBlock[];
}

export interface ServiceBlock {
  id: string; // BookingItem ID
  serviceId?: string;
  serviceName: string;
  _splitTime?: string;
  _isSequentialFollowUp?: boolean;
  displayName?: string; // Tên hiển thị (đặc biệt khi gộp)
  serviceDescription?: string;
  is_utility?: boolean;
  min_ktv_required?: number;
  service_group?: string;
  duration: number;
  price?: number;
  quantity?: number;
  selectedRoomId: string | null;
  bedId: string | null;
  staffList: StaffAssignment[];
  adminNote: string;
  genderReq: string;
  strength: string;
  focus: string;
  avoid: string;
  customerNote: string;
  itemRating?: any;
  timeStart?: string | null;
  timeEnd?: string | null;
  options?: any;
  status?: string; // Tình trạng của dịch vụ con (NEW, PREPARING, IN_PROGRESS, COMPLETED...)
  pauseStart?: string | null; // Thời điểm bắt đầu tạm dừng
  mergedIntoId?: string; // Dịch vụ này đã bị gộp vào dịch vụ khác
  mergedServiceIds?: string[]; // Danh sách các dịch vụ con đã gộp vào dịch vụ này
  customerGroupId?: string; // ID nhóm khách hàng (để gộp đơn con nhưng khác KTV)
  handover_status?: string;
  handover_comment?: string | null;
  handover_images?: string; // JSON string chứa Record<string, string>
  guestId?: string; // ID của Guest đang sử dụng dịch vụ này
}

export type DispatchStatus = 'pending' | 'dispatched' | 'PREPARING' | 'IN_PROGRESS' | 'CLEANING' | 'FEEDBACK' | 'DONE';

export interface PendingOrder {
  id: string; // Booking ID
  parentBookingId?: string | null;
  subSuffix?: string | null;
  billCode: string;
  customerName: string;
  customerId?: string | null;
  phone: string;
  email?: string;
  source?: string;
  isWebBooking?: boolean;
  timeBooking?: string | null;
  vipWarnings?: string[];
  vipConfidence?: string;
  time: string;
  services: ServiceBlock[];
  dispatchStatus: DispatchStatus;
  createdAt: string;
  updatedAt?: string;
  totalAmount?: number;
  paymentMethod?: string;
  hasVat?: boolean;
  rawStatus?: string;
  hasAssignedKtv?: boolean;
  guestCount?: number;
  isReturning?: boolean;
  visitCount?: number;
  nationality?: string;
  customerGender?: string;
  timeStart?: string | null;
  timeEnd?: string | null;
  customerLang?: string;
  accessToken?: string | null;
  rating?: number | null;
  feedbackNote?: string | null;
  rawNotes?: any;
  guests?: GuestBlock[]; // Danh sách khách hàng trong đơn
}

export interface StaffData {
  id: string;
  full_name: string;
  avatar_url?: string | undefined;
  gender?: string | undefined;
  status?: string | undefined;
  skills?: any;
  phone?: string | undefined;
  position?: string | undefined;
  experience?: string | undefined;
  work_type?: string | undefined;
  feature_flags?: any;
  online_status?: string | undefined;
  totalPoints?: number;
  travel_minutes?: number;
  available_from?: string | undefined;
  available_until?: string | undefined;
};

export type TurnQueueData = {
  id?: string;
  employee_id: string;
  date: string;
  queue_position: number;
  check_in_order: number;
  status: 'waiting' | 'assigned' | 'working' | 'done_turn' | 'off';
  turns_completed: number;
  current_order_id?: string | null;
  booking_item_id?: string | null;
  room_id?: string | null;
  bed_id?: string | null;
  estimated_end_time?: string | null;
  start_time?: string | null;
  last_served_at?: string | null;
};

export interface StaffNotification {
  id: string;
  bookingId: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface RoomData {
  id: string;
  name: string;
  type: string;
  capacity?: number;
  default_reminders?: string[];
  has_guests?: boolean;
}

export interface BedData {
  id: string;
  roomId: string;
  name?: string;
}

export interface ReminderData {
  id: string;
  content: string;
}
