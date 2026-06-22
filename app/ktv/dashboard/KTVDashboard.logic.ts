import { useState, useEffect, useCallback, useRef } from 'react';
import { ktvMatchesSeg } from '@/lib/ktvUtils';
// Đã chuyển sang dùng REST API /api/ktv/... thay vì server actions trực tiếp
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useNotifications } from '@/components/NotificationProvider';

export type ScreenState = 'DASHBOARD' | 'TIMER' | 'REVIEW' | 'REWARD' | 'HANDOVER';

const getMinsFromTimes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
    let mins1 = h1 * 60 + m1;
    let mins2 = h2 * 60 + m2;
    if (mins2 < mins1) mins2 += 24 * 60; // cross midnight
    return mins2 - mins1;
};

// 🔧 DEFAULT PROCEDURES (Fallback when room has no config)
const DEFAULT_PREP_PROCEDURE = [
    'Vệ sinh máy lạnh & quạt',
    'Chuẩn bị tinh dầu & dụng cụ',
    'Setup giường (Khăn, gối)',
    'Chuẩn bị khăn nóng',
    'Kiểm tra vệ sinh phòng'
];
const DEFAULT_CLEAN_PROCEDURE = [
    'Thu gom khăn bẩn & rác',
    'Vệ sinh bồn bệ & dụng cụ',
    'Sắp xếp lại gối, nệm',
    'Xịt tinh dầu khử mùi'
];

// 🚩 ROOM ISSUE QUICK OPTIONS
export const ROOM_ISSUE_OPTIONS = [
    'Máy lạnh hư / rò nước',
    'Đèn cháy / hỏng',
    'Thiếu khăn / dụng cụ',
    'Mùi hôi / ẩm mốc',
    'Nghẹt nước / toilet',
    'Hỏng giường / nệm'
];

export interface DashboardConfig {
    initialAction?: string | null;
    targetBookingId?: string | null;
    testTechCode?: string | null;
}

export function useKTVDashboard(config?: DashboardConfig) {
    const { user, hasPermission } = useAuth();
    const { setKtvScreen } = useNotifications();
    const ktvId = config?.testTechCode || user?.id;
    const canViewWallet = hasPermission('ktv_wallet');
    const [screen, setScreenState] = useState<ScreenState>('DASHBOARD');
    const setScreen = useCallback((val: ScreenState) => {
        setScreenState(val);
        setKtvScreen(val);
        try { localStorage.setItem('ktv_active_screen', val); } catch(e) {}
    }, [setKtvScreen]);

    const [booking, setBooking] = useState<any>(null);
    const [showProcedure, setShowProcedure] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    // Dynamic checklist arrays (driven by room config from API)
    const [prepChecklist, setPrepChecklist] = useState<boolean[]>([]);
    const [cleanChecklist, setCleanChecklist] = useState<boolean[]>([]);
    const [showRoomIssueModal, setShowRoomIssueModal] = useState(false);

    // Derive procedure labels from booking data (fallback to defaults)
    const prepProcedure: string[] = booking?.roomPrepProcedure || DEFAULT_PREP_PROCEDURE;
    const cleanProcedure: string[] = booking?.roomCleanProcedure || DEFAULT_CLEAN_PROCEDURE;

    // Initialize checklist arrays when booking/procedures change
    useEffect(() => {
        setPrepChecklist(new Array(prepProcedure.length).fill(false));
    }, [booking?.id, prepProcedure.length]);
    useEffect(() => {
        setCleanChecklist(new Array(cleanProcedure.length).fill(false));
    }, [booking?.id, cleanProcedure.length]);

    const isChecklistComplete = prepChecklist.length > 0 && prepChecklist.every(Boolean);
    const isHandoverComplete = cleanChecklist.length > 0 && cleanChecklist.every(Boolean);

    // Legacy-compatible aliases for page.tsx
    const checklist = prepChecklist;
    const handoverChecklist = cleanChecklist;

    const [settings, setSettings] = useState<any>({
        ktv_setup_duration_minutes: null,
        auto_finish_on_timer_end: true,
        ktv_commission_per_60min: 100000
    });
    const [prepTimeRemaining, setPrepTimeRemaining] = useState(0);
    const [isPrepping, setIsPrepping] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(60 * 60); 
    const [isTimerRunning, setIsTimerRunning] = useState(false);
    const [commission, setCommission] = useState(0);
    const [bonusMessage, setBonusMessage] = useState<string | null>(null);
    const [hasSubmittedReview, setHasSubmittedReview] = useState(false);
    const [canStart, setCanStart] = useState(true);
    const [allowedStartTime, setAllowedStartTime] = useState<Date | null>(null);
    const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
    const [walletBalance, setWalletBalance] = useState<any>(null);
    const [walletTimeline, setWalletTimeline] = useState<any[]>([]);

    const [onCallState, setOnCallState] = useState<{ allow_on_call: boolean; is_on_call: boolean; travel_time_mins: number } | null>(null);

    const lastAcknowledgedIdRef = useRef<string | null>(null);
    const prevBookingIdRef = useRef<string | null>(null);
    const postServiceBookingIdRef = useRef<string | null>(null);
    const POST_SERVICE_BOOKING_KEY = 'ktv_post_service_booking_id';
    const isFirstLoadRef = useRef<boolean>(true);
    const screenRef = useRef<ScreenState>(screen);
    const bookingRef = useRef<any>(null);
    const isPreppingRef = useRef<boolean>(false);
    const isTimerRunningRef = useRef<boolean>(false);
    const manualSegmentOverrideRef = useRef<boolean>(false);
    const activeSegmentIndexRef = useRef<number>(activeSegmentIndex);
    const handleFinishTimerRef = useRef<() => Promise<void>>(async () => {});
    const timeOffsetRef = useRef<number>(0);
    const fetchBookingRef = useRef<(() => Promise<void>) | null>(null);
    const recalcTimerRef = useRef<(() => void) | null>(null);
    const targetBookingIdRef = useRef<string | null>(config?.targetBookingId || null);
    const isTransitioningRef = useRef<boolean>(false);

    // 📸 Selfie photo before starting service
    const [startPhotoBase64, setStartPhotoBase64State] = useState<string | null>(null);

    const setStartPhotoBase64 = useCallback((val: string | null) => {
        setStartPhotoBase64State(val);
        if (!bookingRef.current?.id || !ktvId) return;
        try {
            const key = `ktv_start_photo_${ktvId}_${bookingRef.current.id}_${activeSegmentIndexRef.current}`;
            if (val) {
                localStorage.setItem(key, val);
            } else {
                localStorage.removeItem(key);
            }
        } catch(e) {}
    }, [ktvId]);

    // Restore temporary selfie photo from localStorage on load / booking / segment change
    useEffect(() => {
        if (!booking?.id || !ktvId) {
            setStartPhotoBase64State(null);
            return;
        }
        try {
            const key = `ktv_start_photo_${ktvId}_${booking.id}_${activeSegmentIndex}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                setStartPhotoBase64State(saved);
            } else {
                setStartPhotoBase64State(null);
            }
        } catch(e) {
            setStartPhotoBase64State(null);
        }
    }, [booking?.id, ktvId, activeSegmentIndex]);

    // ⚠️ DO NOT REMOVE — Fix timer drift 16/05/2026
    // Refs cho absolute timer: mỗi tick tính từ Date.now() thay vì prev-1
    // Chống lệch thời gian khi KTV tắt/mở màn hình
    const timerStartMsRef = useRef<number>(0);
    const timerTotalSecsRef = useRef<number>(0);

    // Auto-skip Review ONLY if THIS KTV has already submitted review for THIS specific booking.
    // Source of truth: per-KTV per-booking localStorage flag, NOT booking.rating (booking-level, too coarse).
    useEffect(() => {
        if (screenRef.current !== 'REVIEW' || !booking?.id || !ktvId) return;
        try {
            const reviewKey = `ktv_review_submitted_${ktvId}_${booking.id}`;
            const alreadySubmitted = localStorage.getItem(reviewKey) === 'true';
            if (alreadySubmitted && !hasSubmittedReview) {
                console.log("🌟 [ReviewRestore] This KTV already submitted review, forwarding to HANDOVER...");
                setHasSubmittedReview(true);
                setScreen('HANDOVER');
            }
        } catch(e) {}
    }, [booking?.id, hasSubmittedReview, ktvId]);

    useEffect(() => { 
        screenRef.current = screen; 
    }, [screen]);

    // 🔄 Fetch Wallet Balance when on Dashboard and idle
    useEffect(() => {
        if (screen === 'DASHBOARD' && (!booking || !booking.id) && ktvId) {
            const fetchWallet = async () => {
                try {
                    const res = await fetch(`/api/ktv/wallet/balance?techCode=${ktvId}`);
                    const json = await res.json();
                    if (json.success) setWalletBalance(json.data);

                    const res2 = await fetch(`/api/ktv/wallet/timeline?techCode=${ktvId}`);
                    const json2 = await res2.json();
                    if (json2.success) setWalletTimeline(json2.data);
                } catch (e) {
                    console.error('Error fetching wallet balance/timeline:', e);
                }
            };
            fetchWallet();

            const fetchOnCall = async () => {
                try {
                    const res = await fetch(`/api/ktv/on-call?techCode=${ktvId}`);
                    const json = await res.json();
                    if (json.success && json.data) {
                        setOnCallState(json.data);
                    }
                } catch (e) {
                    console.error('Error fetching on-call state:', e);
                }
            };
            fetchOnCall();
        }
    }, [screen, booking?.id, ktvId]);

    const handleToggleOnCall = async (isOnCall: boolean, mins: number) => {
        if (!ktvId) return;
        try {
            setOnCallState(prev => prev ? { ...prev, is_on_call: isOnCall, travel_time_mins: mins } : null);
            await fetch('/api/ktv/on-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ techCode: ktvId, is_on_call: isOnCall, travel_time_mins: mins })
            });
        } catch (e) {
            console.error('Error toggling on call:', e);
        }
    };

    // 🔄 Full reset of ALL transient state when booking.id changes
    // Prevents timer/segment/prepping/review state from leaking from order 1 into order 2.
    useEffect(() => {
        if (!booking?.id || !ktvId) return;
        try {
            const reviewKey = `ktv_review_submitted_${ktvId}_${booking.id}`;
            const alreadySubmitted = localStorage.getItem(reviewKey) === 'true';
            if (!alreadySubmitted) {
                setHasSubmittedReview(false);
                setIsTimerRunning(false);
                setIsPrepping(false);
                setPrepTimeRemaining(0);
                setActiveSegmentIndex(0);
                manualSegmentOverrideRef.current = false;
            }
        } catch(e) { setHasSubmittedReview(false); }
    }, [booking?.id, ktvId]);


    useEffect(() => {
        try {
            const savedScreen = localStorage.getItem('ktv_active_screen') as ScreenState;
            const savedBookingId = localStorage.getItem(POST_SERVICE_BOOKING_KEY) || localStorage.getItem('ktv_active_booking_id');
            const savedKtvId = localStorage.getItem('ktv_active_ktv_id');
            // 🔒 Chỉ restore nếu đúng ktvId đang đăng nhập — tránh KTV2 kế thừa state của KTV1
            const ktvIdMatches = !savedKtvId || !ktvId || savedKtvId === ktvId;
            if (savedScreen && ['REVIEW', 'HANDOVER', 'REWARD'].includes(savedScreen) && savedBookingId && ktvIdMatches) {
                setScreenState(savedScreen);
                prevBookingIdRef.current = savedBookingId;
                postServiceBookingIdRef.current = savedBookingId;
            } else {
                localStorage.removeItem('ktv_active_screen');
                localStorage.removeItem('ktv_active_booking_id');
                localStorage.removeItem(POST_SERVICE_BOOKING_KEY);
                localStorage.removeItem('ktv_active_ktv_id');
            }
        } catch (e) {}
    }, [ktvId]);
    useEffect(() => { bookingRef.current = booking; }, [booking]);
    useEffect(() => { isPreppingRef.current = isPrepping; }, [isPrepping]);
    useEffect(() => { isTimerRunningRef.current = isTimerRunning; }, [isTimerRunning]);
    useEffect(() => { activeSegmentIndexRef.current = activeSegmentIndex; }, [activeSegmentIndex]);

    // 🔒 Start Lock Logic
    useEffect(() => {
        if (!booking) {
            setCanStart(true);
            setAllowedStartTime(null);
            return;
        }

        const calculateAllowedTime = () => {
            let allowed: Date | null = null;

            if (booking.dispatchStartTime) {
                // Parse dispatchStartTime — có thể là "HH:mm" hoặc ISO timestamp
                const raw = String(booking.dispatchStartTime);
                let d: Date | null = null;
                
                if (/^\d{1,2}:\d{2}$/.test(raw)) {
                    // Format HH:mm
                    const [h, m] = raw.split(':').map(Number);
                    d = new Date();
                    d.setHours(h, m, 0, 0);
                } else {
                    // ISO timestamp hoặc format khác
                    d = new Date(raw);
                }
                
                // Guard: Invalid Date → cho phép bắt đầu ngay
                if (!d || isNaN(d.getTime())) {
                    allowed = null;
                } else {
                    // 🌙 FIX CA ĐÊM: Nếu allowed > now hơn 12h → ca đêm cross midnight → lùi 1 ngày
                    if (d.getTime() - Date.now() > 12 * 60 * 60 * 1000) {
                        d.setDate(d.getDate() - 1);
                    }
                    allowed = d;
                }
            } else if (booking.last_served_at) {
                // Quầy không nhập -> Dùng mốc điều phối + thời gian chuẩn bị
                if (settings.ktv_setup_duration_minutes != null && !isNaN(Number(settings.ktv_setup_duration_minutes))) {
                    const dispatchTime = new Date(booking.last_served_at).getTime();
                    const setupMs = Number(settings.ktv_setup_duration_minutes) * 60 * 1000;
                    allowed = new Date(dispatchTime + setupMs);
                } else {
                    allowed = null; // Cho phép bắt đầu ngay nếu chưa có config
                }
            }

            setAllowedStartTime(allowed);

            if (!allowed) {
                setCanStart(true);
            } else {
                const now = new Date();
                // Cho phép lệch 5s để tránh vấn đề đồng bộ clock nhẹ
                setCanStart(now.getTime() >= (allowed.getTime() - 5000));
            }
        };

        calculateAllowedTime();
        const interval = setInterval(calculateAllowedTime, 1000); // Check mỗi giây để đếm ngược mượt
        return () => clearInterval(interval);
    }, [booking, settings.ktv_setup_duration_minutes]);

    // 🕒 Active Segment & Shifting Logic
    useEffect(() => {
        if (!booking || booking.status !== 'IN_PROGRESS') {
            if (!manualSegmentOverrideRef.current) setActiveSegmentIndex(0);
            return;
        }

        // Skip auto-calc khi KTV đã bấm chuyển chặng thủ công
        if (manualSegmentOverrideRef.current) return;

        const updateActiveSegment = () => {
            if (manualSegmentOverrideRef.current) return;

            // 1. Tìm dịch vụ được gán cho KTV này
            const allItemIds: string[] = booking.assignedItemIds?.length > 0
                ? booking.assignedItemIds
                : (booking.assignedItemId ? [booking.assignedItemId] : []);
            
            const allAssignedItems = allItemIds.length > 0
                ? booking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
                : [booking.BookingItems?.find((i: any) => i.id === booking.assignedItemId) || booking.BookingItems?.[0]].filter(Boolean);

            if (allAssignedItems.length === 0) return;

            // 2. Gom tất cả segments của KTV này
            let allMySegs: any[] = [];
            for (const ai of allAssignedItems) {
                let segs: any[] = [];
                try {
                    segs = typeof ai?.segments === 'string' 
                        ? JSON.parse(ai.segments) 
                        : (Array.isArray(ai?.segments) ? ai.segments : []);
                } catch { segs = []; }
                
                const mySegs = segs.filter((seg: any) => 
                                    ktvMatchesSeg(seg.ktvId, ktvId)
                );
                allMySegs.push(...mySegs);
            }

            // 🚀 Đảm bảo các chặng được hiển thị đúng trình tự thời gian (startTime) do Lễ tân xếp
            allMySegs.sort((a, b) => {
                const timeA = a.startTime || '23:59';
                const timeB = b.startTime || '23:59';
                return timeA.localeCompare(timeB);
            });

            if (allMySegs.length === 0) return;

            // 3. TÍNH TOÁN THEO THỜI GIAN THỰC (actualStartTime & actualEndTime)
            let foundIdx = -1;

            // 3.1 Tìm chặng đang chạy (có start, chưa có end)
            for (let i = allMySegs.length - 1; i >= 0; i--) {
                if (allMySegs[i].actualStartTime && !allMySegs[i].actualEndTime) {
                    foundIdx = i;
                    break;
                }
            }

            // 3.2 Nếu không có chặng đang chạy (ví dụ PREPARING), tìm chặng kế tiếp chưa start
            if (foundIdx === -1) {
                for (let i = 0; i < allMySegs.length; i++) {
                    if (!allMySegs[i].actualStartTime) {
                        foundIdx = i;
                        break;
                    }
                }
            }

            // 3.3 Nếu đã chạy xong hết, trỏ về chặng cuối cùng
            if (foundIdx === -1) {
                foundIdx = allMySegs.length - 1;
            }

            setActiveSegmentIndex(Math.max(0, foundIdx));
        };

        updateActiveSegment();
        const interval = setInterval(updateActiveSegment, 10000);
        return () => clearInterval(interval);
    }, [booking]);

    // 📺 SCREEN TRANSITION ENGINE (Centralized)
    // 🔑 NGUYÊN TẮC: Mỗi KTV CHỈ quan tâm assignedItem.status (item-level)
    // booking.status chỉ dùng cho: CANCELLED, co-working sync (forward only)
    const STATUS_ORDER: Record<string, number> = {
        'PREPARING': 0,
        'READY': 1,
        'IN_PROGRESS': 2,
        'COMPLETED': 3,
        'CLEANING': 3,
        'FEEDBACK': 4,
        'DONE': 5
    };

    useEffect(() => {
        if (!booking) return;

        const assignedItem = booking.assignedItemId 
            ? booking.BookingItems?.find((i: any) => i.id === booking.assignedItemId)
            : booking.BookingItems?.[0];

        // Status item-level ưu tiên tuyệt đối
        let currentStatus = assignedItem?.status || booking.status;
        
        // 🚀 KTV-Specific Local Status Override
        // Cho phép mỗi KTV có trạng thái riêng (hoàn thành/feedback) bất chấp trạng thái tổng của dịch vụ
        const allItemIds: string[] = booking.assignedItemIds?.length > 0
            ? booking.assignedItemIds
            : (booking.assignedItemId ? [booking.assignedItemId] : []);
        const allAssignedItems = allItemIds.length > 0
            ? booking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
            : [assignedItem].filter(Boolean);
        
        let allMySegsForStatus: any[] = [];
        for (const ai of allAssignedItems) {
            let segs: any[] = [];
            try {
                segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
            } catch { segs = []; }
            const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
            allMySegsForStatus.push(...mySegs);
        }

        if (allMySegsForStatus.length > 0) {
            let allDone = true;
            let allFeedback = true;
            let allReview = true;
            let isAnyStarted = false;
            allMySegsForStatus.forEach(seg => {
                if (seg.actualStartTime) isAnyStarted = true;
                if (!seg.actualEndTime) allDone = false;
                if (!seg.feedbackTime) allFeedback = false;
                if (!seg.reviewTime) allReview = false;
            });
            
            // 🔒 Restore hasSubmittedReview từ Database hoặc localStorage
            // Cho phép admin đăng nhập thiết bị khác (không có localStorage) vẫn tự động nhảy qua màn Review
            if (allReview && !hasSubmittedReview) {
                setHasSubmittedReview(true);
            } else if (!hasSubmittedReview) {
                try {
                    const reviewKey = `ktv_review_submitted_${ktvId}_${booking?.id}`;
                    if (localStorage.getItem(reviewKey) === 'true') {
                        setHasSubmittedReview(true);
                    }
                } catch(e) {}
            }

            if (allFeedback) currentStatus = 'FEEDBACK';
            else if (allDone && currentStatus !== 'DONE' && currentStatus !== 'CLEANING') currentStatus = 'CLEANING';
            else if (isAnyStarted) {
                // ⚠️ FIX: Nếu KTV này ĐÃ BẮT ĐẦU nhưng CHƯA XONG (chưa có actualEndTime)
                // Phải ép giữ ở trạng thái IN_PROGRESS để không bị hoàn thành đột ngột
                if (!allDone) {
                    currentStatus = 'IN_PROGRESS';
                } else if (!['DONE', 'CLEANING', 'FEEDBACK', 'IN_PROGRESS'].includes(currentStatus)) {
                    currentStatus = 'IN_PROGRESS';
                }
            } else {
                // ⚠️ FIX: Nếu KTV này CHƯA BẮT ĐẦU (chưa có actualStartTime)
                // nhưng Booking/Item lại đang là IN_PROGRESS / CLEANING / FEEDBACK
                // (do đồng nghiệp làm trước trong ca nối tiếp, hoặc do ép status), 
                // thì BẮT BUỘC ép KTV này về lại PREPARING để họ còn thấy nút "Xác nhận chuẩn bị" / "Bắt đầu".
                // Tuyệt đối KHÔNG ép lên IN_PROGRESS, vì sẽ làm Timer tự chạy sai giờ.
                // 🔒 NGOẠI LỆ: Nếu client đã set isTimerRunning = true (KTV vừa bấm Bắt đầu)
                //    → giữ IN_PROGRESS, không ép về PREPARING (Realtime race condition)
                if (isTimerRunningRef.current) {
                    // Client confirmed start, server just hasn't written actualStartTime yet
                    currentStatus = 'IN_PROGRESS';
                } else if (['IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'DONE'].includes(currentStatus)) {
                    console.log(`🔧 [ScreenEngine] KTV ${ktvId} chưa bắt đầu nhưng item=${currentStatus} → ép về PREPARING/READY`);
                    if (isPreppingRef.current && screenRef.current === 'TIMER') {
                        currentStatus = 'READY';
                    } else {
                        currentStatus = 'PREPARING';
                    }
                }
            }
            
            // 🔒 ABSOLUTE GUARD: Nếu timer đang chạy (isTimerRunning = true) → KHÔNG được chuyển sang CLEANING/FEEDBACK/DONE
            // Ngăn chặn ghost completion do race condition (allDone = true khi actualEndTime từ session cũ còn trong DB)
            if (isTimerRunningRef.current && ['CLEANING', 'FEEDBACK', 'DONE'].includes(currentStatus)) {
                console.warn(`🛡️ [ScreenEngine] Timer đang chạy nhưng status=${currentStatus} → ép giữ IN_PROGRESS`);
                currentStatus = 'IN_PROGRESS';
            }
        }

        // 🔒 UNIVERSAL TIMER GUARD (ngoài allMySegsForStatus block):
        // Khi isTimerRunning = true (KTV đã bấm Bắt đầu), KHÔNG được để status về PREPARING/READY
        // Fix: segments có ktvId rỗng → allMySegsForStatus = [] → guard bên trong không chạy
        //      → currentStatus = assignedItem.status = 'PREPARING' (chưa được update bởi API)
        //      → ScreenEngine gọi PREPARING path → setTimeRemaining(reset) → timer bị reset mỗi Realtime event
        if (isTimerRunningRef.current && ['PREPARING', 'READY', 'PENDING', 'CONFIRMED'].includes(currentStatus)) {
            console.warn(`🛡️ [ScreenEngine] Timer đang chạy nhưng currentStatus=${currentStatus} → ép về IN_PROGRESS`);
            currentStatus = 'IN_PROGRESS';
        }

        const currentScreen = screenRef.current;
        const statusLevel = STATUS_ORDER[currentStatus] ?? -1;


        console.log("📟 [ScreenEngine] Final Check:", { currentStatus, itemStatus: assignedItem?.status, bookingStatus: booking.status, currentScreen, statusLevel });

        // 🚀 Forward-only Guard: Không lùi UI về PREPARING/READY do lỗi polling
        if (statusLevel <= 1 && ['TIMER', 'REVIEW', 'HANDOVER', 'REWARD'].includes(currentScreen)) {
            if (currentScreen !== 'TIMER' || !isPreppingRef.current) {
                console.log(`🚫 [ScreenEngine] Chặn kéo ngược từ ${currentScreen} về ${currentStatus}`);
                return;
            }
        }

        // 🚫 CANCELLED: luôn xử lý (booking-level)
        if (booking.status === 'CANCELLED') {
            setBooking(null);
            setScreen('DASHBOARD');
            return;
        }

        if (currentStatus === 'READY' && currentScreen === 'DASHBOARD') {
            const parsed = Number(settings.ktv_setup_duration_minutes);
            const setupMs = (!isNaN(parsed) ? parsed : 0) * 60;
            setPrepTimeRemaining(setupMs);
            setIsPrepping(true);
            setScreen('TIMER');
        } 
        else if (currentStatus === 'IN_PROGRESS') {
            // Guard: KHÔNG kéo ngược KTV đã hoàn thành về TIMER
            // Ngoại lệ: Nếu postServiceBookingId khác booking hiện tại → KTV đã chuyển sang đơn mới → XÓA guard
            const postServiceScreens = ['REVIEW', 'HANDOVER', 'REWARD'];
            const isSamePostServiceBooking = postServiceBookingIdRef.current && postServiceBookingIdRef.current === booking?.id;
            if (postServiceScreens.includes(currentScreen) && isSamePostServiceBooking) return;

            if (currentScreen !== 'TIMER' || isPreppingRef.current) {
                setScreen('TIMER');
                setIsPrepping(false);
            }
            setIsTimerRunning(true);
        }
        else if (['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE'].includes(currentStatus)) {
            if (!postServiceBookingIdRef.current && booking?.id) {
                postServiceBookingIdRef.current = booking.id;
                try { 
                    localStorage.setItem(POST_SERVICE_BOOKING_KEY, booking.id);
                    // 🔒 Lưu kèm ktvId để restore có thể kiểm tra đúng người
                    if (ktvId) localStorage.setItem('ktv_active_ktv_id', ktvId); 
                } catch (e) {}
            }
            // 🔑 KTV bắt buộc phải đi đúng trình tự: REVIEW -> HANDOVER -> REWARD
            // KHÔNG ép setHasSubmittedReview(true) tự động để tránh lỗi nhảy cóc (skip).
            if (!hasSubmittedReview) {
                if (currentScreen !== 'REVIEW') {
                    setScreen('REVIEW');
                    setIsTimerRunning(false);
                }
            } else {
                // Nếu đã Review xong, chuyển sang HANDOVER (nếu chưa ở đó hoặc chưa tới REWARD)
                if (currentScreen !== 'HANDOVER' && currentScreen !== 'REWARD') {
                    setScreen('HANDOVER');
                    setIsTimerRunning(false);
                }
            }
        }
    }, [booking, settings.ktv_setup_duration_minutes, hasSubmittedReview, ktvId]);

    // 🔊 Audio Notification Logic - Moved to NotificationProvider for consistency
    useEffect(() => {
        if (!isLoading && isFirstLoadRef.current) {
            prevBookingIdRef.current = booking?.id || null;
            isFirstLoadRef.current = false;
            return;
        }
        if (['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current) && postServiceBookingIdRef.current) {
            return;
        }
        prevBookingIdRef.current = booking?.id || null;
    }, [booking, isLoading]);

    // ✨ Bonus Points logic - Sound handled by NotificationProvider
    useEffect(() => {
        if (!ktvId) return;

        const checkRewards = async () => {
            if (screenRef.current === 'TIMER') return;

            try {
                const response = await fetch(`/api/ktv/notifications?techCode=${ktvId}`);
                const res = await response.json();
                
                if (res.success && res.data && res.data.length > 0) {
                    const notify = res.data[0];
                    setBonusMessage(notify.message);
                    
                    // Marks as read, sound is played by global NotificationProvider via Realtime
                    await fetch(`/api/ktv/notifications?id=${notify.id}`, { method: 'PATCH' });
                    
                    setTimeout(() => setBonusMessage(null), 15000);
                }
            } catch (err) {
                console.error('Error checking rewards:', err);
            }
        };

        // Check ngay khi load và khi trạng thái thay đổi sang IDLE
        checkRewards();

        // Realtime listener cho thông báo mới
        const channel = supabase
            .channel(`ktv_rewards_${ktvId}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'StaffNotifications',
                filter: `employeeId=eq.${ktvId}`
            }, () => {
                checkRewards();
            })
            .subscribe();

        const interval = setInterval(checkRewards, 60000); // Poll mỗi phút đề phòng realtime tạch

        return () => {
            supabase.removeChannel(channel);
            clearInterval(interval);
        };
    }, [ktvId, screen]);

    // ⚙️ Fetch Settings
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch('/api/ktv/settings');
                const res = await response.json();
                if (res.success) setSettings(res.data);
            } catch (err) { console.error('Error fetching settings:', err); }
        };
        fetchSettings();
    }, []);

    // 📡 Realtime & Polling Fetch
    useEffect(() => {
        if (!ktvId) return;

        const fetchBooking = async () => {
            try {
                if (!ktvId) return;

                // Mặc định: Lấy đơn đang gán cho KTV trong TurnQueue
                let url = `/api/ktv/booking?techCode=${ktvId}`;
                
                // Nâng cao: Ưu tiên track đơn cũ khi đang ở màn hậu kỳ (REVIEW/HANDOVER/REWARD)
                const isPostService = ['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current);
                if (isPostService && !postServiceBookingIdRef.current) {
                    try {
                        const savedPostServiceBookingId = localStorage.getItem(POST_SERVICE_BOOKING_KEY);
                        if (savedPostServiceBookingId) {
                            postServiceBookingIdRef.current = savedPostServiceBookingId;
                        }
                    } catch (e) {}
                }
                
                const overrideBookingId = targetBookingIdRef.current;
                if (overrideBookingId) {
                    url = `/api/ktv/booking?bookingId=${overrideBookingId}&techCode=${ktvId}`;
                } else if (isPostService && postServiceBookingIdRef.current) {
                    // Ưu tiên fetch theo ID đơn vừa làm để tránh bị mất dữ liệu khi đã RELEASE_KTV
                    url = `/api/ktv/booking?bookingId=${postServiceBookingIdRef.current}&techCode=${ktvId}`;
                    console.log("🔍 [KTV] Persisting booking fetch for post-service screen:", postServiceBookingIdRef.current);
                }
                // (Đã gộp vào logic ở trên)

                const response = await fetch(url);
                const res = await response.json();
                
                if (res.success && res.data && res.data.id) {
                    if (isTransitioningRef.current) {
                        console.log("🛡️ [KTV] Skipping fetch update due to manual transition");
                        return;
                    }
                    const currentIsPostService = ['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current);
                    const currentLockedBookingId = postServiceBookingIdRef.current || bookingRef.current?.id || prevBookingIdRef.current;
                    if (currentIsPostService && currentLockedBookingId && res.data.id !== currentLockedBookingId) {
                        console.log("🚫 [KTV] Ignoring booking drift during post-service flow:", {
                            lockedBookingId: currentLockedBookingId,
                            incomingBookingId: res.data.id
                        });
                        return;
                    }

                    if (currentIsPostService && !postServiceBookingIdRef.current && currentLockedBookingId) {
                        postServiceBookingIdRef.current = currentLockedBookingId;
                        try { localStorage.setItem(POST_SERVICE_BOOKING_KEY, currentLockedBookingId); } catch (e) {}
                    }

                    console.log("📡 [KTV] Fetch Success - ID:", res.data.id, "Status:", res.data.status, "Rating:", res.data.rating);
                    // IGNORE if this is the booking we just finished and acknowledged
                    if (res.data.id === lastAcknowledgedIdRef.current) {
                        setBooking(null);
                        return;
                    }

                    // Update state ONLY if data actually changed to avoid timer reset & sound spam
                    setBooking((prev: any) => {
                        const newRating = Number(res.data.rating || 0);
                        const oldRating = Number(prev?.rating || 0);
                        
                        const isNew = !prev || prev.id !== res.data.id;
                        if (isNew) {
                            prevBookingIdRef.current = res.data.id;
                            try { localStorage.setItem('ktv_active_booking_id', res.data.id); } catch(e) {}
                        }
                        
                        // 1. Tìm dịch vụ được gán cho KTV này
                        const assignedItem = res.data.assignedItemId 
                            ? res.data.BookingItems?.find((i: any) => i.id === res.data.assignedItemId)
                            : res.data.BookingItems?.[0];

                        // Tính thời gian cho TẤT CẢ items được gán (multi-item support)
                        const allItemIds: string[] = res.data.assignedItemIds?.length > 0
                            ? res.data.assignedItemIds
                            : (res.data.assignedItemId ? [res.data.assignedItemId] : []);
                        const allAssignedItems = allItemIds.length > 0
                            ? res.data.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
                            : [assignedItem].filter(Boolean);
                        
                        // Tập hợp tất cả segments gán cho KTV này (theo thứ tự)
                        let allMySegs: any[] = [];
                        for (const ai of allAssignedItems) {
                            let segs: any[] = [];
                            try {
                                segs = typeof ai?.segments === 'string' 
                                    ? JSON.parse(ai.segments) 
                                    : (Array.isArray(ai?.segments) ? ai.segments : []);
                            } catch { segs = []; }
                            
                            const mySegs = segs.filter((seg: any) => 
                                                                ktvMatchesSeg(seg.ktvId, ktvId)
                            );
                            
                            const mySegsWithId = mySegs.map((seg: any) => ({ ...seg, _itemId: ai.id }));
                            allMySegs.push(...mySegsWithId);
                        }

                        allMySegs.sort((a, b) => {
                            const timeA = a.startTime || '23:59';
                            const timeB = b.startTime || '23:59';
                            return timeA.localeCompare(timeB);
                        });

                        // Kiểm tra Rule Merge Timer: CÙNG PHÒNG → merge 1 timer tổng
                        // (khác phòng → chia chặng riêng)
                        const uniqueRoomIds = new Set(allMySegs.map((s: any) => s.roomId || 'unknown'));
                        const uniqueItemIds = new Set(allMySegs.map((s: any) => s._itemId || s.itemId));
                        const hasFinishedSegment = allMySegs.some((s: any) => s.actualEndTime);
                        const shouldMerge = allMySegs.length > 1 && uniqueItemIds.size === allMySegs.length && uniqueRoomIds.size === 1 && !hasFinishedSegment;

                        let currentStatus = assignedItem?.status || res.data.status;
                        
                        // 🚀 KTV-Specific Local Status Override
                        if (allMySegs.length > 0) {
                            let allDone = true;
                            let allFeedback = true;
                            let isAnyStarted = false;
                            allMySegs.forEach(seg => {
                                if (seg.actualStartTime) isAnyStarted = true;
                                if (!seg.actualEndTime) allDone = false;
                                if (!seg.feedbackTime) allFeedback = false;
                            });
                            
                            if (allFeedback) currentStatus = 'FEEDBACK';
                            else if (allDone && currentStatus !== 'DONE' && currentStatus !== 'CLEANING') currentStatus = 'CLEANING';
                            else if (isAnyStarted) {
                                if (!['DONE', 'CLEANING', 'FEEDBACK', 'IN_PROGRESS', 'CANCELLED'].includes(currentStatus)) currentStatus = 'IN_PROGRESS';
                            } else {
                                // ⚠️ FIX: Nếu KTV này CHƯA BẮT ĐẦU (chưa có actualStartTime)
                                if (['IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'DONE'].includes(currentStatus)) {
                                    if (isPreppingRef.current && screenRef.current === 'TIMER') {
                                        currentStatus = 'READY';
                                    } else {
                                        currentStatus = 'PREPARING';
                                    }
                                }
                            }
                        }

                        // Debug log 
                        console.log(`[KTV] Assigned Item ID: ${assignedItem?.id}, Item Status: ${assignedItem?.status}, Booking Status: ${res.data.status}, Final Computed Status: ${currentStatus}`);



                        allMySegs.sort((a, b) => {
                            const timeA = a.startTime || '23:59';
                            const timeB = b.startTime || '23:59';
                            return timeA.localeCompare(timeB);
                        });

                        let calculatedSegIdx = manualSegmentOverrideRef.current ? activeSegmentIndex : 0;
                        if (!manualSegmentOverrideRef.current) {
                            if (allMySegs.length > 0 && allMySegs.some(s => s.actualStartTime)) {
                                // Tìm chặng đang active dựa trên actualStartTime
                                let foundIdx = -1;
                                for (let i = allMySegs.length - 1; i >= 0; i--) {
                                    if (allMySegs[i].actualStartTime) {
                                        foundIdx = i;
                                        break;
                                    }
                                }
                                if (foundIdx >= 0) { calculatedSegIdx = foundIdx; } else { const nextIdx = allMySegs.findIndex(s => !s.actualStartTime); if (nextIdx !== -1) calculatedSegIdx = nextIdx; }
                            } else if (currentStatus === 'IN_PROGRESS' && res.data.timeStart) {
                                // Fallback đếm ngược ảo nếu chưa có segments time tracking
                                let tStart = res.data.timeStart;
                                if (typeof tStart === 'string' && !tStart.includes('Z') && !tStart.includes('+')) {
                                    tStart = tStart.replace(' ', 'T') + 'Z';
                                }
                                const start = new Date(tStart).getTime();
                                const elapsedMins = (new Date().getTime() - start) / 60000;
                                let acc = 0;
                                for (let i = 0; i < allMySegs.length; i++) {
                                    acc += allMySegs[i].duration;
                                    // Nếu chưa xong chặng này
                                    if (elapsedMins <= acc) { calculatedSegIdx = i; break; }
                                }
                            }
                        }
                        // Nếu đang PREPARING mà KTV check activeSegmentIndex > 0 (đã chạy trước đó)
                        if (currentStatus === 'PREPARING' && activeSegmentIndex > 0) {
                            calculatedSegIdx = activeSegmentIndex;
                        }
                        
                        // Cập nhật lại state index để UI đồng bộ
                        if (!manualSegmentOverrideRef.current && calculatedSegIdx !== activeSegmentIndex) {
                            setActiveSegmentIndex(calculatedSegIdx);
                        }

                        // Bỏ qua ROUTING MÀN HÌNH nội bộ vì useEffect gốc đã đảm đương việc này. Đồng thời tránh lỗi loop push về DASHBOARD khi READY.
                        
                        const isStatusChanged = prev?.currentStatus !== currentStatus;
                        const isRatingChanged = oldRating !== newRating;
                        
                        if (isNew || isStatusChanged || isRatingChanged || JSON.stringify(prev?.BookingItems) !== JSON.stringify(res.data.BookingItems)) {
                            if (res.serverTime) {
                                const clientNow = new Date().getTime();
                                const serverNow = new Date(res.serverTime).getTime();
                                timeOffsetRef.current = serverNow - clientNow;
                            }
                            // Lưu trạng thái tính toán vào object để so sánh lần sau
                            res.data.currentStatus = currentStatus;
                            
                            // [Sửa đổi]: Đếm lùi theo từng chặng (current segment only)
                            const currentSeg = allMySegs[calculatedSegIdx] || allMySegs[0] || {};
                            let currentSegDuration = Number(currentSeg.duration) || assignedItem?.duration || 60;
                            
                            if (shouldMerge) {
                                currentSegDuration = allMySegs.reduce((sum: number, s: any) => sum + (Number(s.duration) || 60), 0);
                            }
                            
                            console.log("⏱️ [Timer] calculatedSegIdx:", calculatedSegIdx, "currentSegDuration:", currentSegDuration, "totalSegs:", allMySegs.length, "shouldMerge:", shouldMerge);

                            // Cập nhật thời gian dựa trên chặng hiện tại
                            const currentSecs = currentSegDuration * 60;
                            let tStart = assignedItem?.timeStart || res.data.timeStart;
                            
                            if (currentStatus === 'IN_PROGRESS') {
                                // Nếu đã override chặng thủ công, KHÔNG ghi đè timer
                                if (!manualSegmentOverrideRef.current) {
                                    // Dùng actualStartTime của chặng HIỆN TẠI
                                    let activeSegStartTime = currentSeg.actualStartTime || tStart;
                                    if (activeSegStartTime) {
                                        if (typeof activeSegStartTime === 'string' && /^\d{1,2}:\d{2}/.test(activeSegStartTime)) {
                                            const [h, m] = activeSegStartTime.split(':').map(Number);
                                            const d = new Date(); d.setHours(h, m, 0, 0);
                                            activeSegStartTime = d.toISOString();
                                        } else if (typeof activeSegStartTime === 'string' && !activeSegStartTime.includes('Z') && !activeSegStartTime.includes('+')) {
                                            activeSegStartTime = activeSegStartTime.replace(' ', 'T') + 'Z';
                                        }
                                        const start = new Date(activeSegStartTime).getTime();
                                        const now = new Date().getTime() + timeOffsetRef.current;
                                        const elapsed = Math.floor((now - start) / 1000);
                                        
                                        // Đếm lùi cho chặng hiện tại
                                        setTimeRemaining(Math.max(0, currentSecs - elapsed));
                                    }
                                }
                            } else if (!isTimerRunningRef.current) {
                                // Chỉ reset timer khi CHƯA chạy (tránh nhảy số khi đang đếm ngược)
                                setTimeRemaining(currentSecs);
                            }

                            return res.data;
                        }
                        return prev;
                    });
                } else if (res.success && (!res.data || !res.data.id)) {
                    // 🛡️ BẢO VỆ STATE: Giữ nguyên booking cũ, chỉ append nextBookingId, KHÔNG ghi đè null/object thiếu id
                    if (res.data?.nextBookingId) {
                        setBooking((prev: any) => prev ? { ...prev, nextBookingId: res.data.nextBookingId } : res.data);
                    }

                    // Chỉ xóa booking khỏi state nếu KHÔNG phải màn hình hậu kỳ
                    const isPostService = ['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current);
                    
                    // 🛡️ RACE CONDITION GUARD: Khi screen vẫn là TIMER nhưng booking đã kết thúc
                    // → Screen Engine chưa kịp chuyển sang REVIEW → KHÔNG được đá về DASHBOARD
                    const isTimerWithActiveBooking = screenRef.current === 'TIMER' && bookingRef.current?.id;
                    
                    if (!isPostService && !isTimerWithActiveBooking) {
                        setBooking(res.data?.nextBookingId ? res.data : null);
                        setScreen('DASHBOARD');
                        setIsTimerRunning(false);
                        setIsPrepping(false);
                        setPrepTimeRemaining(0);
                        setTimeRemaining(60 * 60);
                        manualSegmentOverrideRef.current = false;
                        setActiveSegmentIndex(0);
                    } else if (isTimerWithActiveBooking && !isPostService) {
                        // Set postServiceBookingIdRef sớm để bảo vệ khỏi các poll tiếp theo
                        const lockedId = bookingRef.current!.id;
                        postServiceBookingIdRef.current = lockedId;
                        try { localStorage.setItem(POST_SERVICE_BOOKING_KEY, lockedId); } catch (e) {}
                        console.log("🛡️ [KTV] Booking released while on TIMER — locking for post-service flow:", lockedId);
                    } else {
                        console.log("🕯️ [KTV] Booking released from DB, but keeping UI for cleanup...");
                    }
                }
            } catch (err) {
                console.error('Error fetching booking:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchBooking();

        // Subscribe to real-time changes
        const channel = supabase
            .channel(`ktv_realtime_${ktvId}`)
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'Bookings',
                filter: booking?.id ? `id=eq.${booking.id}` : undefined
            }, (payload: any) => {
                console.log("🔄 [KTV] Realtime Booking Update:", payload.new.status);
                
                // Nếu đơn hàng bị hủy → set ngay
                if (payload.new.status === 'CANCELLED') {
                    setBooking(null);
                    setScreen('DASHBOARD');
                    try {
                        localStorage.removeItem('ktv_active_screen');
                        localStorage.removeItem('ktv_active_booking_id');
                    } catch(e) {}
                    return;
                }

                // 🚀 KHÔNG set partial data cho bất kỳ status nào có liên quan đến BookingItems
                // Partial spread gây ra booking.status mới + BookingItems.status cũ → Screen Engine sai
                // Chỉ fetchBooking() để lấy data hoàn chỉnh, nhất quán
                fetchBooking();
            })
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'BookingItems'
            }, (payload: any) => {
                const currentBooking = bookingRef.current;
                if (!currentBooking) return;
                
                const myBookingId = currentBooking.id;
                const payloadBookingId = payload.new?.bookingId || payload.old?.bookingId;
                
                // 1. Kiểm tra xem event này có thuộc về Booking hiện tại không
                const isMyBooking = payloadBookingId === myBookingId;
                const isMyItem = currentBooking.BookingItems?.some((i: any) => i.id === (payload.new?.id || payload.old?.id));
                
                if (!isMyBooking && !isMyItem) return;
                
                console.log("🔄 [KTV] Realtime BookingItem Sync:", payload.eventType, payload.new?.id, payload.new?.status);
                
                // Nếu là UPDATE một item đã có sẵn thì partial update state trước để UI nhanh, sau đó fetch
                if (payload.eventType === 'UPDATE' && isMyItem) {
                    setBooking((prev: any) => {
                        if (!prev) return prev;
                        const items = prev.BookingItems?.map((i: any) => i.id === payload.new.id ? { ...i, ...payload.new } : i) || [];
                        return { ...prev, BookingItems: items };
                    });
                }
                
                // Luôn fetchBooking để lấy danh sách items hoàn chỉnh (xử lý case INSERT Add-on)
                fetchBooking();
            })
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'TurnQueue',
                filter: `employee_id=eq.${ktvId}`
            }, (payload: any) => {
                console.log("🔄 [KTV] Realtime TurnQueue change:", payload.eventType);
                // 🔒 Block during post-service: auto-handoff TurnQueue event must NOT pull order 2 in mid-cleanup
                if (['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current)) {
                    console.log("🚫 [KTV] TurnQueue realtime blocked — in post-service flow:", screenRef.current);
                    return;
                }
                fetchBooking();
            })
            .subscribe();

        // Polling fallback — skip during post-service to prevent order 2 from drifting into order 1 cleanup
        fetchBookingRef.current = fetchBooking;
        
        const intervalId = setInterval(() => {
            if (['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current)) {
                console.log('🕒 [KTV] Polling skipped — in post-service flow:', screenRef.current);
                return;
            }
            fetchBooking();
        }, 60000); // Tăng từ 5s lên 60s để ngăn nghẽn CPU Vercel

        return () => {
            supabase.removeChannel(channel);
            clearInterval(intervalId);
        };
    // ⚡ PERF: Removed isTimerRunning & isPrepping from deps to prevent channel re-subscription
    // on every timer state change. These values are accessed via refs inside fetchBooking.
    }, [ktvId, booking?.id, booking?.assignedItemId]);

    // 🕵️ Next Order Watcher — Polls for new assignments while KTV is finishing the current one
    // This ensures the "Next Order" button appears even if the dispatch happens late.
    useEffect(() => {
        if (!ktvId || !['DASHBOARD', 'HANDOVER', 'REWARD'].includes(screen)) return;

        const checkNextOrder = async () => {
            try {
                // Fetch using techCode + current bookingId to exclude it from "next order" search
                const currentId = bookingRef.current?.id || '';
                const url = `/api/ktv/booking?techCode=${ktvId}${currentId ? `&bookingId=${currentId}` : ''}`;
                const res = await fetch(url).then(r => r.json());
                if (res.success && res.data?.nextBookingId) {
                    setBooking((prev: any) => {
                        // If current booking is the same as nextBookingId, don't show it as "next"
                        if (prev?.id === res.data.nextBookingId) return prev;
                        if (prev && prev.nextBookingId === res.data.nextBookingId) return prev;
                        
                        console.log("🔔 [KTV Watcher] New order detected:", res.data.nextBookingId);
                        if (!prev) return { nextBookingId: res.data.nextBookingId };
                        return { ...prev, nextBookingId: res.data.nextBookingId };
                    });
                }
            } catch (e) {}
        };

        const tid = setInterval(checkNextOrder, 30000); // Tăng từ 5s lên 30s để tiết kiệm CPU
        checkNextOrder(); // Initial check
        return () => clearInterval(tid);
    }, [ktvId, screen]);

    // ⏱️ Timer countdown — PREV-1 (đơn giản, ổn định, không phụ thuộc refs)
    // recalcTimerFromServer sẽ sync giá trị đúng từ server khi cần (wake-from-sleep, Realtime)
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (isPrepping && prepTimeRemaining > 0) {
            timer = setInterval(() => {
                setPrepTimeRemaining(prev => {
                    if (prev <= 1) {
                        setIsPrepping(false);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else if (isTimerRunning && !isPrepping) {
            // ✅ Dùng Absolute Time thay vì prev-1 để chống drift khi treo tab/background
            timer = setInterval(() => {
                if (!timerStartMsRef.current || !timerTotalSecsRef.current) {
                    setTimeRemaining(prev => Math.max(0, prev - 1));
                    return;
                }
                const now = new Date().getTime() + timeOffsetRef.current;
                const elapsed = Math.floor((now - timerStartMsRef.current) / 1000);
                const newRemaining = Math.max(0, timerTotalSecsRef.current - elapsed);
                setTimeRemaining(newRemaining);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [isPrepping, isTimerRunning]); // Bỏ timeRemaining và prepTimeRemaining khỏi deps để không bị khựng clock do clearInterval chạy lại mỗi giây

    // 📱 Tự động đồng bộ & recalculate Timer khi có data mới từ Lễ tân hoặc khi mở lại app
    useEffect(() => {
        const recalcTimerFromServer = () => {
            const currentBooking = bookingRef.current;
            if (!currentBooking) return;

            const assignedItem = currentBooking.assignedItemId 
                ? currentBooking.BookingItems?.find((i: any) => i.id === currentBooking.assignedItemId)
                : currentBooking.BookingItems?.[0];
            
            let tStart = assignedItem?.timeStart || currentBooking.timeStart;
            if (!tStart) return;

            if (typeof tStart === 'string' && !tStart.includes('Z') && !tStart.includes('+')) {
                tStart = tStart.replace(' ', 'T') + 'Z';
            }

            const allItemIds: string[] = currentBooking.assignedItemIds?.length > 0
                ? currentBooking.assignedItemIds
                : (currentBooking.assignedItemId ? [currentBooking.assignedItemId] : []);
            const allItems = allItemIds.length > 0
                ? currentBooking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
                : [assignedItem].filter(Boolean);
            
            let allMySegs: any[] = [];
            for (const ai of allItems) {
                let segs: any[] = [];
                try {
                    segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
                } catch { segs = []; }
                const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
                const mySegsWithId = mySegs.map((seg: any) => ({ ...seg, _itemId: ai.id }));
                allMySegs.push(...mySegsWithId);
            }

            allMySegs.sort((a, b) => {
                const timeA = a.startTime || '23:59';
                const timeB = b.startTime || '23:59';
                return timeA.localeCompare(timeB);
            });

            // [Sửa đổi]: Detect merge (1 KTV, 2 DV) → dùng tổng duration
            const calculatedSegIdx = activeSegmentIndexRef.current;

            // Tính isMerge tương tự handleStartTimer
            const segItemIdSet = new Set<string>();
            for (const seg of allMySegs) {
                for (const ai of allItems) {
                    let aiSegs: any[] = [];
                    try { aiSegs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []); } catch { aiSegs = []; }
                    if (aiSegs.some((s: any) => s.ktvId?.toLowerCase() === ktvId?.toLowerCase() && s.startTime === seg.startTime && s.duration === seg.duration)) {
                        segItemIdSet.add(ai.id);
                        break;
                    }
                }
            }
            // Merge: gộp các dịch vụ khác nhau
            const uniqueItemIdsForSync = new Set(allMySegs.map((s: any) => s._itemId || s.itemId));
            const isMergeSync = allMySegs.length > 1 && uniqueItemIdsForSync.size === allMySegs.length;

            let currentSegDuration: number;
            let activeSegStartTime: string | null = null;

            const parseTimeHelper = (timeStr: string) => {
                if (!timeStr) return new Date().getTime();
                if (typeof timeStr === 'string' && /^\d{1,2}:\d{2}/.test(timeStr)) {
                    const [h, m] = timeStr.split(':').map(Number);
                    const d = new Date(); d.setHours(h, m, 0, 0);
                    return d.getTime();
                }
                if (typeof timeStr === 'string' && !timeStr.includes('Z') && !timeStr.includes('+')) {
                    return new Date(timeStr.replace(' ', 'T') + 'Z').getTime();
                }
                return new Date(timeStr).getTime();
            };

            if (isMergeSync) {
                // 🛡️ REGRESSION PREVENTION: SMART MERGE LOGIC
                // KHÔNG ĐƯỢC sửa đổi thuật toán "Sequential Time Allocation" bên dưới.
                // Thuật toán này đảm bảo khi Quầy Lễ Tân thêm DV2 vào *sau khi* DV1 đã bắt đầu (có Gap),
                // thời lượng của DV2 KHÔNG bị DV1 nuốt mất (nếu DV1 bị lố giờ).
                // Cơ chế: Tính mốc thời gian hoàn tất nối tiếp (currentVirtualEndMs),
                // sau đó dịch ngược thời gian bắt đầu ảo (synthesizedStartMs) để bộ đếm lùi tuyệt đối chạy đúng.
                
                // 🔥 Smart Merge: Tính tổng duration
                currentSegDuration = allMySegs.reduce((sum: number, s: any) => sum + (Number(s.duration) || 60), 0);
                
                // Nếu chưa có actualStartTime thật sự từ DB, giữ nguyên để GUARD chặn lại
                if (!allMySegs[0].actualStartTime) {
                    activeSegStartTime = tStart;
                } else {
                    // Smart Merge Sequential Time Allocation
                    let currentVirtualEndMs = parseTimeHelper(allMySegs[0].actualStartTime);
                    for (const s of allMySegs) {
                        const durMs = (Number(s.duration) || 60) * 60 * 1000;
                        const dispatchTimeMs = parseTimeHelper(s.startTime || s.actualStartTime || tStart);
                        const segmentStartMs = Math.max(currentVirtualEndMs, dispatchTimeMs);
                        currentVirtualEndMs = segmentStartMs + durMs;
                    }
                    // Tính toán activeSegStartTime ảo để timer đếm ngược chính xác từ tổng duration
                    const synthesizedStartMs = currentVirtualEndMs - (currentSegDuration * 60 * 1000);
                    activeSegStartTime = new Date(synthesizedStartMs).toISOString();
                }
            } else {
                // Normal: duration chặng hiện tại
                const currentSeg = allMySegs[calculatedSegIdx] || allMySegs[0] || {};
                currentSegDuration = Number(currentSeg.duration) || assignedItem?.duration || 60;
                activeSegStartTime = currentSeg.actualStartTime || tStart;
            }

            const currentSecs = currentSegDuration * 60;
            
            // 🔒 GUARD: Chỉ sync khi có actualStartTime thực sự từ DB
            // Nếu chỉ có tStart (giờ đặt lịch), KHÔNG dùng để tính elapsed → sẽ ra sai
            if (!activeSegStartTime || !allMySegs[0]?.actualStartTime) {
                // ⚠️ FIX: Nếu Lễ tân ÉP KÉO thẻ sang IN_PROGRESS nhưng KTV chưa tự bấm
                // -> Vẫn cho phép tính countdown dựa vào item.timeStart (tStart)
                if (booking.status === 'IN_PROGRESS' && tStart) {
                    activeSegStartTime = tStart;
                } else {
                    return;
                }
            }
            
            if (activeSegStartTime && typeof activeSegStartTime === 'string' && /^\d{1,2}:\d{2}/.test(activeSegStartTime)) {
                const [h, m] = activeSegStartTime.split(':').map(Number);
                const d = new Date(); d.setHours(h, m, 0, 0);
                activeSegStartTime = d.toISOString();
            } else if (activeSegStartTime && typeof activeSegStartTime === 'string' && !activeSegStartTime.includes('Z') && !activeSegStartTime.includes('+')) {
                activeSegStartTime = activeSegStartTime.replace(' ', 'T') + 'Z';
            }

            if (activeSegStartTime) {
                const start = new Date(activeSegStartTime).getTime();
                const now = new Date().getTime() + timeOffsetRef.current;
                const elapsed = Math.floor((now - start) / 1000);

                // 🔥 Lưu vào ref để countdown interval dùng absolute time
                // ⚠️ LUÔN set refs, kể cả khi isTimerRunning=false
                // → Để khi ScreenEngine set isTimerRunning=true (cho KTV 2 trong shared segment),
                //   countdown interval có thể dùng ngay timerStartMsRef đúng
                timerStartMsRef.current = start;
                timerTotalSecsRef.current = currentSecs;

                const newRemaining = Math.max(0, currentSecs - elapsed);
                console.log(`📱 [Timer Sync] Recalculated timer: ${newRemaining}s remaining (duration: ${currentSegDuration}m, merged: ${isMergeSync})`);
                
                // Chỉ cập nhật display khi timer đang thực sự chạy
                if (isTimerRunningRef.current) {
                    // 🔒 HARD GUARD: KHÔNG cho override về 0 nếu timer mới chạy < 10 giây
                    const timerRunningForMs = now - timerStartMsRef.current;
                    setTimeRemaining(prev => {
                        if (newRemaining === 0 && timerRunningForMs < 10000) {
                            console.warn(`🛡️ [Timer Sync] Blocked override to 0 — timer just started (${timerRunningForMs}ms ago)`);
                            return prev;
                        }
                        if (Math.abs(prev - newRemaining) > 2) {
                            return newRemaining;
                        }
                        return prev;
                    });
                }
            }
        };

        // Chạy ngay khi booking thay đổi (do Lễ tân update hoặc Realtime)
        recalcTimerRef.current = recalcTimerFromServer;
        recalcTimerFromServer();

        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                // 🔥 Fetch dữ liệu MỚI từ server trước khi recalc
                // Nếu dùng bookingRef cũ (stale), actualStartTime có thể = undefined
                // → guard return sớm → timer không được sync → hiện sai
                if (fetchBookingRef.current) {
                    await fetchBookingRef.current();
                }
                recalcTimerFromServer();
            }
        };

        const handleFocus = async () => {
            if (fetchBookingRef.current) {
                await fetchBookingRef.current();
            }
            recalcTimerFromServer();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, [booking, isTimerRunning, ktvId]);

    // 🏁 Auto-finish: trigger khi timer đạt 0 (tách riêng khỏi countdown để React xử lý đúng)
    useEffect(() => {
        if (isTimerRunning && !isPrepping && timeRemaining === 0) {
            // Guard an toàn: chỉ kích hoạt nếu KTV đã thực sự bắt đầu
            // Tránh trường hợp lỗi fetch data khiến timeRemaining = 0 ảo ngay lúc mount
            let hasStarted = false;
            if (booking && ktvId) {
                // ⚠️ BẢO VỆ TUYỆT ĐỐI: Nếu timerRemaining = 0 do khởi tạo, block Autofinish
                if (timerStartMsRef.current === 0) {
                    console.warn(`🛡️ [AutoFinish Blocked] timerStartMsRef is 0. Ignoring.`);
                    return;
                }
                try {
                    const allItems: any[] = booking.BookingItems || [];
                    const allAssignedItems = allItems.filter((bi: any) => {
                        const codes: string[] = bi.technicianCodes || [];
                        return codes.map((c: string) => c.toLowerCase()).includes(ktvId.toLowerCase());
                    });
                    for (const ai of allAssignedItems) {
                        let segs: any[] = [];
                        try {
                            segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
                        } catch { segs = []; }
                        const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
                        if (mySegs.some((s: any) => s.actualStartTime)) {
                            hasStarted = true;
                            break;
                        }
                    }
                } catch(e) {
                    // Nếu lỗi parse → vẫn cho phép AutoFinish chạy để KTV không bị kẹt
                    hasStarted = true;
                }
            } else {
                // Không có booking data → vẫn cho AutoFinish để không bị kẹt
                hasStarted = true;
            }

            if (hasStarted) {
                const timerRunningForMs = Date.now() - timerStartMsRef.current;
                if (timerStartMsRef.current && timerRunningForMs < 10000) {
                    console.warn(`🛡️ [AutoFinish] Blocked! Timer reached 0 but it only started ${timerRunningForMs}ms ago. This is likely a state race condition.`);
                    return;
                }
                console.log('🏁 [AutoFinish] Timer reached 0, calling handleFinishTimer...');
                handleFinishTimerRef.current();
            } else {
                console.warn('⚠️ [AutoFinish] Blocked — no actualStartTime found. Possibly stale data on mount.');
            }
        }
    }, [timeRemaining, isTimerRunning, isPrepping, booking, ktvId]);

    const toggleChecklist = (index: number) => {
        setPrepChecklist(prev => prev.map((v, i) => i === index ? !v : v));
    };

    const toggleHandoverChecklist = (index: number) => {
        setCleanChecklist(prev => prev.map((v, i) => i === index ? !v : v));
    };

    const checkAllChecklist = () => {
        setPrepChecklist(prev => prev.map(() => true));
    };

    const checkAllHandoverChecklist = () => {
        setCleanChecklist(prev => prev.map(() => true));
    };

    // 🚩 Room Issue Report
    const handleReportRoomIssue = async (issues: string[], note: string) => {
        if (!booking || !ktvId) return;
        setIsLoading(true);
        try {
            const roomId = booking.assignedRoomId || booking.roomName || 'N/A';
            const issueText = issues.length > 0 ? issues.join(', ') : '';
            const fullMessage = `🚩 BÁO SỰ CỐ PHÒNG ${roomId} — KTV ${ktvId}: ${issueText}${note ? ` | ${note}` : ''}`;

            await fetch('/api/ktv/interaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    type: 'EMERGENCY',
                    techCode: ktvId,
                    message: fullMessage
                })
            });
            setShowRoomIssueModal(false);
            alert('Đã gửi báo cáo sự cố về Lễ tân!');
        } catch (err) {
            console.error('Error reporting room issue:', err);
            alert('Lỗi gửi báo cáo!');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmSetup = async () => {
        if (!booking || !ktvId || !booking.assignedItemId) return;
        
        setIsLoading(true);
        // Cập nhật trạng thái Item lên Server để đồng bộ cho các KTV khác cùng làm dịch vụ này
        const response = await fetch('/api/ktv/booking', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                bookingId: booking.id, 
                status: 'READY',
                techCode: ktvId 
            })
        });
        
        const res = await response.json();
        if (res.success) {
            const assignedItem = booking.BookingItems?.find((i: any) => i.id === booking.assignedItemId) || booking.BookingItems?.[0];

            // Lấy segments gán cho KTV này
            const allItemIds: string[] = booking.assignedItemIds?.length > 0
                ? booking.assignedItemIds
                : (booking.assignedItemId ? [booking.assignedItemId] : []);
            const allItems = allItemIds.length > 0
                ? booking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
                : [assignedItem].filter(Boolean);
            
            let allMySegs: any[] = [];
            for (const ai of allItems) {
                let segs: any[] = [];
                try {
                    segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
                } catch { segs = []; }
                const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
                
                mySegs.forEach((seg: any) => seg._itemId = ai.id); // 🔥 Explicitly inject _itemId
                allMySegs.push(...mySegs);
            }

            allMySegs.sort((a, b) => {
                const timeA = a.startTime || '23:59';
                const timeB = b.startTime || '23:59';
                return timeA.localeCompare(timeB);
            });

            // Tính shouldMerge để set timer đúng tổng nếu cần
            const segItemIds = new Set(allMySegs.map((s: any) => s._itemId).filter(Boolean));
            const uniqueRoomIds = new Set(allMySegs.map((s: any) => s.roomId || 'unknown'));
            const uniqueItemIdsForPrep = new Set(allMySegs.map((s: any) => s._itemId || s.itemId));
            const hasFinishedSegment = allMySegs.some((s: any) => s.actualEndTime);
            const isMerge = allMySegs.length > 1 && uniqueItemIdsForPrep.size === allMySegs.length && uniqueRoomIds.size === 1 && !hasFinishedSegment;

            const initDuration = isMerge
                ? allMySegs.reduce((sum: number, s: any) => sum + (Number(s.duration) || 60), 0)
                : (allMySegs.length > 0 ? (Number(allMySegs[0].duration) || 60) : (assignedItem?.duration || 60));
            
            setTimeRemaining(initDuration * 60);
            const parsed = Number(settings.ktv_setup_duration_minutes);
            const setupMs = !isNaN(parsed) ? parsed : 0;
            setPrepTimeRemaining(setupMs * 60);
            setIsPrepping(true);
            setScreen('TIMER');
        } else {
            alert('Lỗi xác nhận chuẩn bị: ' + (res.error || 'Unknown error'));
        }
        setIsLoading(false);
    };

    const handleStartTimer = async () => {
        if (!booking || !ktvId) return;

        // Tính toán shouldMerge để gửi lên API START_TIMER
        const allItemIds: string[] = booking.assignedItemIds?.length > 0
            ? booking.assignedItemIds
            : (booking.assignedItemId ? [booking.assignedItemId] : []);
        const allItems = allItemIds.length > 0
            ? booking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
            : [booking.BookingItems?.[0]].filter(Boolean);

        let allMySegs: any[] = [];
        for (const ai of allItems) {
            let segs: any[] = [];
            try {
                segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
            } catch { segs = []; }
            const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
            const mySegsWithId = mySegs.map((seg: any) => ({ ...seg, _itemId: ai.id }));
            allMySegs.push(...mySegsWithId);
        }
        
        // Merge: gộp tất cả các dịch vụ riêng biệt (cùng phòng) thành 1 chặng liên tục
        const uniqueRoomIds = new Set(allMySegs.map((s: any) => s.roomId || 'unknown'));
        const uniqueItemIds = new Set(allMySegs.map((s: any) => s._itemId || s.itemId));
        const hasFinishedSegment = allMySegs.some((s: any) => s.actualEndTime);
        const shouldMerge = allMySegs.length > 1 && uniqueItemIds.size === allMySegs.length && uniqueRoomIds.size === 1 && !hasFinishedSegment;

        setIsLoading(true);
        const response = await fetch('/api/ktv/booking', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                bookingId: booking.id, 
                status: 'IN_PROGRESS',
                techCode: ktvId,
                action: 'START_TIMER',
                shouldMerge: shouldMerge,
                photoBase64: startPhotoBase64
            })
        });
        const res = await response.json();
        if (res.success) {
            // 📸 Clean up check-in photo from preview and localStorage
            setStartPhotoBase64(null);

            // 🚀 Gửi tín hiệu Broadcast sang Lễ tân để UI cập nhật tức thời
            supabase.channel('dispatch_board_realtime').send({
                type: 'broadcast',
                event: 'KTV_STARTED',
                payload: {
                    bookingId: booking.id,
                    ktvId: ktvId,
                    startTime: new Date().toISOString()
                }
            }).catch(e => console.error("Broadcast failed", e));

            // 🔥 Set refs NGAY LẬP TỨC để interval countdown chạy được
            // Không cần chờ recalcTimerFromServer (sẽ chạy sau khi server refresh)
            const initDuration = shouldMerge
                ? allMySegs.reduce((sum: number, s: any) => sum + (Number(s.duration) || 60), 0)
                : (allMySegs.length > 0 ? (Number(allMySegs[0].duration) || 60) : (booking?.assignedItem?.duration || 60));
            timerStartMsRef.current = Date.now() + timeOffsetRef.current;
            timerTotalSecsRef.current = initDuration * 60;
            // ✅ Set timeRemaining ngay để timer hiển thị đúng duration (nhất là merged 2-DV = 10 phút)
            setTimeRemaining(initDuration * 60);
            setIsTimerRunning(true);
        } else {
            console.error('❌ [KTV Logic] Start error:', res.error);
            alert('Lỗi cập nhật trạng thái: ' + (res.error || 'Unknown error'));
        }
        setIsLoading(false);
    };

    const handleFinishTimer = async () => {
        if (!booking || !ktvId) return;

        // 🔎 Kiểm tra: còn chặng nào phía sau không?
        const allItemIds: string[] = booking.assignedItemIds?.length > 0
            ? booking.assignedItemIds
            : (booking.assignedItemId ? [booking.assignedItemId] : []);
        const allItems = allItemIds.length > 0
            ? booking.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
            : [booking.BookingItems?.[0]].filter(Boolean);

        let allMySegs: any[] = [];
        for (const ai of allItems) {
            let segs: any[] = [];
            try {
                segs = typeof ai?.segments === 'string' ? JSON.parse(ai.segments) : (Array.isArray(ai?.segments) ? ai.segments : []);
            } catch { segs = []; }
            const mySegs = segs.filter((seg: any) => ktvMatchesSeg(seg.ktvId, ktvId));
            const mySegsWithId = mySegs.map((seg: any) => ({ ...seg, _itemId: ai.id }));
            allMySegs.push(...mySegsWithId);
        }
        allMySegs.sort((a, b) => (a.startTime || '23:59').localeCompare(b.startTime || '23:59'));

        // Merge: cùng phòng → 1 timer tổng, khác phòng → chặng riêng
        const uniqueRoomIds = new Set(allMySegs.map((s: any) => s.roomId || 'unknown'));
        const uniqueItemIds = new Set(allMySegs.map((s: any) => s._itemId || s.itemId));
        const hasFinishedSegment = allMySegs.some((s: any) => s.actualEndTime);
        const shouldMerge = allMySegs.length > 1 && uniqueItemIds.size === allMySegs.length && uniqueRoomIds.size === 1 && !hasFinishedSegment;

        const currentIdx = activeSegmentIndex;
        // Nếu shouldMerge = true, bỏ qua advance và coi như đã làm xong chặng cuối
        const hasNextSegment = currentIdx < allMySegs.length - 1 && !shouldMerge;

        if (hasNextSegment) {
            // 🔄 AUTO-ADVANCE: Còn chặng tiếp → chuyển sang chặng kế, KHÔNG finish
            console.log(`🔄 [AutoAdvance] Segment ${currentIdx} done, advancing to ${currentIdx + 1}/${allMySegs.length - 1}`);
            setIsLoading(true);

            const nextIdx = currentIdx + 1;
            const response = await fetch('/api/ktv/booking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    status: 'IN_PROGRESS',
                    techCode: ktvId,
                    action: 'NEXT_SEGMENT',
                    activeSegmentIndex: nextIdx
                })
            });
            const res = await response.json();
            if (res.success) {
                setActiveSegmentIndex(nextIdx);
                activeSegmentIndexRef.current = nextIdx;
                manualSegmentOverrideRef.current = true;

                // Reset timer cho chặng mới
                const nextSeg = allMySegs[nextIdx];
                const nextDuration = Number(nextSeg?.duration) || 60;
                setTimeRemaining(nextDuration * 60);
                console.log(`⏱️ [AutoAdvance] Timer reset to ${nextDuration} minutes for segment ${nextIdx}`);

                // Fetch lại booking để cập nhật segments mới (actualStartTime/EndTime)
                if (fetchBookingRef.current) fetchBookingRef.current();
            } else {
                console.error('❌ [AutoAdvance] Error:', res.error);
                alert('Lỗi chuyển chặng: ' + (res.error || 'Unknown error'));
            }
            setIsLoading(false);
        } else {
            // 🏁 Chặng cuối cùng done → chuyển sang CLEANING
            console.log(`🏁 [FinishAll] All ${allMySegs.length} segments done, transitioning to CLEANING`);
            setIsLoading(true);
            const response = await fetch('/api/ktv/booking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    bookingId: booking.id, 
                    status: 'CLEANING',
                    techCode: ktvId
                })
            });
            const res = await response.json();
            if (res.success) {
                // 🚀 Gửi tín hiệu Broadcast sang Lễ tân
                supabase.channel('dispatch_board_realtime').send({
                    type: 'broadcast',
                    event: 'KTV_FINISHED',
                    payload: {
                        bookingId: booking.id,
                        ktvId: ktvId,
                        finishTime: new Date().toISOString()
                    }
                }).catch(e => console.error("Broadcast failed", e));

                setIsTimerRunning(false);
                postServiceBookingIdRef.current = booking.id;
                try { localStorage.setItem(POST_SERVICE_BOOKING_KEY, booking.id); } catch (e) {}
                
                isTransitioningRef.current = true;
                setScreen('REVIEW');
                setTimeout(() => isTransitioningRef.current = false, 1000);
            } else {
                console.error('❌ [KTV Logic] Finish error:', res.error);
                alert('Lỗi cập nhật trạng thái: ' + (res.error || 'Unknown error'));
            }
            setIsLoading(false);
        }
    };

    // Keep ref up-to-date so timer callback always calls latest version
    handleFinishTimerRef.current = handleFinishTimer;

    const handleSubmitReview = async (customerProfile: any) => {
        if (!booking || !ktvId) {
            console.log("🚨 [KTV Logic] Mất dữ liệu phiên làm việc, ép thoát về DASHBOARD");
            setScreen('DASHBOARD');
            try {
                localStorage.removeItem('ktv_active_screen');
                localStorage.removeItem('ktv_active_booking_id');
                localStorage.removeItem(POST_SERVICE_BOOKING_KEY);
            } catch(e) {}
            return;
        }
        
        setIsLoading(true);
        try {
            const personality = customerProfile.personality || [];
            let noteContent = '';
            if (personality.length > 0) {
                noteContent = `[Đánh giá KTV: ${personality.join(', ')}]`;
            }
            const reviewBookingId = postServiceBookingIdRef.current || booking.id;
            
            // Gọi API chuyên trách (chỉ cập nhật review, không can thiệp trạng thái tổng)
            const response = await fetch('/api/ktv/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    bookingId: reviewBookingId, 
                    notes: noteContent,
                    techCode: ktvId
                })
            });
            
            const res = await response.json();
            if (!res.success) {
                console.error('❌ [KTV Logic] Lỗi khi gửi đánh giá:', res.error);
                alert('Không thể lưu đánh giá: ' + (res.error || 'Vui lòng thử lại'));
                return; // 🚫 Chặn không cho đi tiếp
            }
            
            setHasSubmittedReview(true);
            // Persist per-KTV per-booking review flag — survives refresh, prevents state leaking to next order
            try {
                const reviewKey = `ktv_review_submitted_${ktvId}_${reviewBookingId}`;
                localStorage.setItem(reviewKey, 'true');
            } catch(e) {}
            
            // Always go to HANDOVER — commission is calculated in handleFinishHandover()
            isTransitioningRef.current = true;
            setScreen('HANDOVER');
            setTimeout(() => isTransitioningRef.current = false, 1000);
        } catch (err) {
            console.error('❌ [KTV Logic] Network error submitting review:', err);
            alert('Lỗi kết nối. Vui lòng kiểm tra mạng và thử lại!');
        } finally {
            setIsLoading(false);
        }
    };


    const handleFinishHandover = async () => {
        if (!booking || !ktvId) {
            console.log("🚨 [KTV Logic] Mất dữ liệu phiên làm việc ở bước Dọn phòng, ép thoát về DASHBOARD");
            setScreen('DASHBOARD');
            try {
                localStorage.removeItem('ktv_active_screen');
                localStorage.removeItem('ktv_active_booking_id');
                localStorage.removeItem(POST_SERVICE_BOOKING_KEY);
            } catch(e) {}
            postServiceBookingIdRef.current = null;
            return;
        }
        setIsLoading(true);
        try {
            // 🔥 TÍNH TIỀN TUA CHÍNH XÁC: Theo thời gian admin gán trong segments
            // Hỗ trợ multi-item: 1 KTV + 2 DV → assignedItemIds = ["id1", "id2"]
            const itemIds: string[] = booking.assignedItemIds?.length > 0
                ? booking.assignedItemIds
                : (booking.assignedItemId ? [booking.assignedItemId] : []);
            
            const assignedItems = itemIds.length > 0
                ? booking.BookingItems?.filter((i: any) => itemIds.includes(i.id)) || []
                : [booking.BookingItems?.[0]].filter(Boolean);
            
            // Filter bỏ dịch vụ tiện ích (is_utility) — không tính vào tiền tua
            const serviceItems = assignedItems.filter((item: any) => {
                const sId = String(item.serviceId || '').toUpperCase();
                const sName = String(item.service_name || '').toLowerCase();
                return item.is_utility !== true
                       && sId !== 'NHS0900'  // Legacy fallback
                       && !sName.includes('phòng riêng') 
                       && !sName.includes('phong rieng');
            });

            let parsedMilestones: any = null;
            if (typeof settings.ktv_commission_milestones === 'string') {
                try {
                    parsedMilestones = JSON.parse(settings.ktv_commission_milestones);
                } catch (e) {}
            } else if (settings.ktv_commission_milestones && typeof settings.ktv_commission_milestones === 'object') {
                parsedMilestones = settings.ktv_commission_milestones;
            }

            const milestones = parsedMilestones || {
                '1': 2000, '30': 50000, '45': 75000, '60': 100000, '70': 115000, 
                '90': 150000, '120': 200000, '180': 300000, '300': 500000
            };
            let rate60 = Number(settings.ktv_commission_per_60min);
            if (isNaN(rate60) || rate60 <= 0) rate60 = 100000;

            const calculateCommissionForMins = (mins: number) => {
                if (isNaN(mins) || mins <= 0) return 0;
                const minsStr = String(mins);
                if (milestones[minsStr] != null) {
                    return Number(milestones[minsStr]);
                } else {
                    return Math.round(((mins / 60) * rate60) / 1000) * 1000;
                }
            };

            // Tính tiền cho TỪNG dịch vụ riêng biệt rồi cộng lại (Thay vì cộng dồn phút rồi mới tính tiền)
            let totalCommission = 0;
            let totalMins = 0; // Vẫn tính totalMins để log
            
            for (const item of serviceItems) {
                let itemMins = 0;
                if (item?.segments) {
                    try {
                        const segs = typeof item.segments === 'string' 
                            ? JSON.parse(item.segments) 
                            : (item.segments || []);
                        const mySegs = segs.filter((seg: any) => 
                                            ktvMatchesSeg(seg.ktvId, ktvId)
                        );
                        if (mySegs.length > 0) {
                            itemMins = mySegs.reduce((sum: number, seg: any) => {
                                const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                                if (realMins > 0) return sum + realMins;
                                const dur = Number(seg.duration);
                                return sum + (isNaN(dur) ? 0 : dur);
                            }, 0);
                        } else {
                            const dur = Number(item.duration);
                            itemMins = isNaN(dur) || dur <= 0 ? 60 : dur;
                        }
                    } catch { 
                        const dur = Number(item.duration);
                        itemMins = isNaN(dur) || dur <= 0 ? 60 : dur; 
                    }
                } else {
                    const dur = Number(item?.duration);
                    itemMins = isNaN(dur) || dur <= 0 ? 60 : dur;
                }
                
                itemMins = Number(itemMins);
                if (isNaN(itemMins) || itemMins <= 0) itemMins = 60; // fallback per item
                
                totalMins += itemMins;
                const comm = calculateCommissionForMins(itemMins);
                totalCommission += (isNaN(comm) ? 0 : comm);
            }
            
            // Fallback nếu không có item nào
            if (serviceItems.length === 0) {
                totalMins = 60;
                totalCommission = calculateCommissionForMins(60);
            }
            
            if (isNaN(totalCommission)) totalCommission = 0;

            console.log("💰 [Commission] Items:", itemIds.length, "Total Duration:", totalMins, "Total Commission:", totalCommission);

            // 1. Giải phóng KTV khỏi TurnQueue
            const response = await fetch('/api/ktv/booking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    bookingId: postServiceBookingIdRef.current || booking.id, 
                    status: 'FEEDBACK', // Dọn xong → chờ khách đánh giá. Nếu đã có rating → API sẽ set DONE
                    action: 'RELEASE_KTV', // BÂY GIỜ mới giải phóng KTV
                    techCode: ktvId 
                })
            });
            const res = await response.json();
            
            if (!res.success) {
                console.error('Lỗi khi giải phóng KTV:', res.error);
            }

            setCommission(totalCommission);

            // KHÔNG xoá booking ở đây để Reward còn lấy được rating/points
            setPrepChecklist(prev => prev.map(() => false));
            setCleanChecklist(prev => prev.map(() => false));
            setIsPrepping(false);
            setPrepTimeRemaining(0);
            
            // Luôn chuyển sang REWARD để KTV thấy thành quả công việc
            isTransitioningRef.current = true;
            setScreen('REWARD');
            setTimeout(() => isTransitioningRef.current = false, 1000);
        } catch (err) {
            console.error('Error in finish handover:', err);
            isTransitioningRef.current = true;
            setScreen('REWARD');
            setTimeout(() => isTransitioningRef.current = false, 1000);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInteraction = async (type: 'WATER' | 'SUPPORT' | 'EMERGENCY' | 'BUY_MORE' | 'EARLY_EXIT') => {
        if (!booking) return;
        setIsLoading(true);
        try {
            const response = await fetch('/api/ktv/interaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: booking.id, type, techCode: ktvId })
            });
            const res = await response.json();
            if (res.success) {
                console.log(`Sent interaction: ${type}`);
            } else {
                alert('Lỗi gửi yêu cầu');
            }
        } catch (err) {
            console.error('Error sending interaction:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEarlyExit = async () => {
        if (!booking || !ktvId) return;
        if (!confirm('Thông báo cho quầy khách muốn kết thúc sớm?')) return;
        
        // 🚀 THAY ĐỔI: Không tự ý PATCH status
        // Thay vào đó gửi Interaction 'EARLY_EXIT' để Lễ tân xử lý
        // Khi lễ tân xử lý xong (Hoàn tất trên Dispatch Board), Realtime sẽ tự đưa KTV qua trang REVIEW/REWARD
        await handleInteraction('EARLY_EXIT');
        alert('Đã gửi yêu cầu về sớm. Hãy đợi Lễ tân xác nhận để hoàn tất đơn hàng.');
    };

    const goToDashboard = (nextId?: string | null) => {
        console.log("🏠 [KTV Logic] Returning to Dashboard. Next ID:", nextId);
        lastAcknowledgedIdRef.current = prevBookingIdRef.current;
        setBooking(null);
        setScreen('DASHBOARD');
        postServiceBookingIdRef.current = null;
        
        // Nếu có đơn tiếp theo, cưỡng bức fetch đơn đó bằng cách set targetBookingId
        if (nextId) {
            targetBookingIdRef.current = nextId;
        } else {
            // Ngược lại nếu không có đơn mới, xóa target cũ để fetch tự do từ TurnQueue
            targetBookingIdRef.current = null;
            // Xóa query param từ URL để nếu refresh trang không bị dính lại đơn cũ
            try {
                window.history.replaceState(null, '', window.location.pathname);
            } catch(e) {}
        }

        try {
            localStorage.removeItem('ktv_active_screen');
            localStorage.removeItem('ktv_active_booking_id');
            localStorage.removeItem(POST_SERVICE_BOOKING_KEY);
        } catch(e) {}

        // 🚀 Trigger fetch immediately instead of waiting for 5s interval
        setTimeout(() => {
            fetchBookingRef.current?.();
        }, 100);
    };

    return {
        user,
        ktvId,
        screen,
        booking,
        isLoading,
        checklist,
        toggleChecklist,
        isChecklistComplete,
        handleConfirmSetup,
        timeRemaining,
        isTimerRunning,
        prepTimeRemaining,
        isPrepping,
        handleStartTimer,
        handleFinishTimer,
        handleSubmitReview,
        handoverChecklist,
        toggleHandoverChecklist,
        checkAllChecklist,
        checkAllHandoverChecklist,
        isHandoverComplete,
        handleFinishHandover,
        commission,
        bonusMessage,
        setBonusMessage,
        goToDashboard,
        showProcedure,
        setShowProcedure,
        handleInteraction,
        handleEarlyExit,
        canStart,
        allowedStartTime,
        activeSegmentIndex,
        startPhotoBase64,
        setStartPhotoBase64,
        // Room procedures & issue reporting
        prepProcedure,
        cleanProcedure,
        showRoomIssueModal,
        setShowRoomIssueModal,
        handleReportRoomIssue,
        settings,
        walletBalance,
        walletTimeline,
        onCallState,
        handleToggleOnCall,
        canViewWallet,
        forceRefresh: async () => {
            if (fetchBookingRef.current) await fetchBookingRef.current();
            if (recalcTimerRef.current) recalcTimerRef.current();
        },
        fetchWalletBalance: async () => {
            if (!ktvId) return;
            try {
                const res = await fetch(`/api/ktv/wallet/balance?techCode=${ktvId}`);
                const json = await res.json();
                if (json.success) setWalletBalance(json.data);
            } catch (e) {
                console.error('Error fetching wallet balance:', e);
            }
        },
        fetchWalletTimeline: async (month?: number, year?: number) => {
            if (!ktvId) return;
            try {
                let url = `/api/ktv/wallet/timeline?techCode=${ktvId}`;
                if (month) url += `&month=${month}`;
                if (year) url += `&year=${year}`;
                const res = await fetch(url);
                const json = await res.json();
                if (json.success) setWalletTimeline(json.data);
            } catch (e) {
                console.error('Error fetching wallet timeline:', e);
            }
        }
    };
}

