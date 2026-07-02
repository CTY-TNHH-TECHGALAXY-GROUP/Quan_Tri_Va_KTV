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
}

export interface StaffAssignment {
  id: string; // Internal mapping ID
  ktvId: string;
  ktvName: string;
  segments: WorkSegment[];
  noteForKtv: string;
}

export interface ServiceBlock {
  id: string; // BookingItem ID
  serviceId?: string;
  serviceName: string;
  serviceDescription?: string;
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
  timeStart?: string | null;
  timeEnd?: string | null;
  options?: any;
  status?: string; // Tình trạng của dịch vụ con (NEW, PREPARING, IN_PROGRESS, COMPLETED...)
}

export type DispatchStatus = 'pending' | 'dispatched' | 'PREPARING' | 'IN_PROGRESS' | 'CLEANING' | 'FEEDBACK' | 'DONE';

export interface PendingOrder {
  id: string; // Booking ID
  billCode: string;
  customerName: string;
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
  timeStart?: string | null;
  timeEnd?: string | null;
  customerLang?: string;
  accessToken?: string | null;
  rating?: number | null;
  feedbackNote?: string | null;
  rawNotes?: any;
}

export type StaffData = {
  id: string;
  full_name: string;
  status: string;
  gender: string;
  skills: Record<string, boolean>;
  phone: string;
  position: string;
  avatar_url: string;
  experience: string;
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
