export type ModuleId =
  | 'dashboard'
  | 'dispatch_board'
  | 'order_management'
  | 'customer_management'
  | 'revenue_reports'
  | 'payroll_commissions'
  | 'cashbook_supplies'
  | 'finance_management'
  | 'finance_piggy_bank'
  | 'web_booking'
  | 'service_menu'
  | 'customer_reminders'
  | 'role_management'
  | 'employee_management'
  | 'ktv_hub'
  | 'leave_management'
  | 'ktv_dashboard'
  | 'ktv_wallet'
  | 'ktv_attendance'
  | 'ktv_schedule'
  | 'ktv_performance'
  | 'ktv_history'
  | 'turn_tracking'
  | 'service_handbook'
  | 'ai_features'
  | 'staff_notifications'
  | 'device_management'
  | 'room_management'
  | 'staff_features'
  | 'notification_settings'
  | 'support_dashboard'
  | 'support_tasks_admin'
  | 'support_reviews_admin'
  | 'employee_tasks'
  | 'settings'
  | 'system_settings';

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  group: string;
}

export type SkillLevel = boolean;

export interface EmployeeSkills {
  hairCut: SkillLevel;
  shampoo: SkillLevel;
  hairExtensionShampoo: SkillLevel;
  earCombo: SkillLevel;
  earChuyen: SkillLevel;
  machineShave: SkillLevel;
  razorShave: SkillLevel;
  facial: SkillLevel;
  thaiBody: SkillLevel;
  shiatsuBody: SkillLevel;
  oilBody: SkillLevel;
  hotStoneBody: SkillLevel;
  scrubBody: SkillLevel;
  bodyMix: SkillLevel;
  foot: SkillLevel;
  heelScrub: SkillLevel;
  nailCombo: SkillLevel;
  nailChuyen: SkillLevel;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  username?: string;
  password?: string;
  dob: string;
  gender: 'Nam' | 'Nữ' | 'Khác' | string;
  idCard: string;
  phone: string;
  email: string;
  bankAccount: string;
  bankName: string;
  photoUrl: string;
  position: string;
  experience: string;
  joinDate: string;
  height: number;
  weight: number;
  skills: EmployeeSkills;
  baseSalary: number;
  commissionRate: number;
  rating: number;
  baseSalaryPerHour?: number;
  targetHoursPerMonth?: number;
  isActiveVipMenu?: boolean;
  isHomeSpa?: boolean;
  role?: string;
  work_type?: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: ModuleId[];
}

export interface User {
  id: string;
  name: string;
  roleId: string;
  avatarUrl?: string;
  password?: string;
  code?: string;
  featureFlags?: Record<string, boolean>;
}

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  gender?: string;
  nationality?: string;
  guestType?: string;
  preferredGender?: string;
  preferredLang?: string;
  preferredStrength?: string;
  birthday?: string;
  notes?: string;
  lastVisited?: string;
  createdAt?: string;
  updatedAt?: string;
  // VAT Invoice fields
  taxCode?: string;
  companyName?: string;
  companyAddress?: string;
  companyEmail?: string;
  companyPhone?: string;
  // Aggregated fields
  totalSpent?: number;
  visitCount?: number;
  vipMenuCount?: number;
  ktvReviews?: string[];
  // V9 Export Fields
  frequentTimeFrame?: string;
  usedSources?: string;
  usedVipMenu?: boolean;
  topService?: string;
  topKtv?: string;
  allKtvs?: string;
  visitsLast30Days?: number;
  visitsLast7Days?: number;
  avgRating?: string;
  [key: string]: any;
}

export interface Room {
  id: string;
  name: string;
  type: string;
  floor: number;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance';
}

export interface Bed {
  id: string;
  roomId: string;
  name: string;
  status: 'available' | 'occupied';
}

export interface FocusConfig {
  [key: string]: boolean;
}

export interface Service {
  id: string;
  code?: string;
  name: string; // legacy fallback
  nameVN?: string;
  nameEN?: string;
  nameCN?: string;
  nameJP?: string;
  nameKR?: string;
  
  category: string;
  duration: number;
  price: number; // legacy fallback
  priceVND?: number;
  priceUSD?: number;
  
  description?: any;
  service_description?: string;
  procedure?: string;
  
  imageUrl?: string;
  image_url?: string; // legacy fallback
  
  isActive?: boolean;
  isBestSeller?: boolean;
  isBestChoice?: boolean;
  
  showCustomForYou?: boolean;
  showNotes?: boolean;
  showGender?: boolean;
  showStrength?: boolean;
  showFocus?: boolean;
  showPreferences?: boolean; // Legacy
  
  focusConfig?: FocusConfig | null;
  tags?: (string | Record<string, string>)[] | null;
  hint?: any;
}

