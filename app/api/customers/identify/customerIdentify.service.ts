import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isDummyPhone, isDummyEmail, COMPLETED_STATUSES } from '@/lib/customer.logic';
import { computeProfileVisit, type VisitStatus } from '@/lib/services/CustomerVisitService';

interface CustomerIdentifyParams {
    phone?: string;
    email?: string;
}

interface CustomerIdentifyResult {
    isReturning: boolean;
    visitCount: number;
    visitStatus: VisitStatus;
    customer: {
        name: string;
        phone: string;
        notes: string;
    } | null;
    preferences: {
        topService: string;
        topKtv: string;
        preferredStrength: string;
    } | null;
    wowMessage: string;
    greetingSuggestion: string;
}

export class CustomerIdentifyService {
    public static async identifyCustomer(params: CustomerIdentifyParams): Promise<CustomerIdentifyResult> {
        const { phone, email } = params;
        if (!phone && !email) {
            throw new Error("Vui lòng cung cấp số điện thoại hoặc email");
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin not initialized");

        const validPhone = phone && !isDummyPhone(phone) ? phone : null;
        const validEmail = email && !isDummyEmail(email) ? email : null;

        // 1. Tra cứu thông tin Khách hàng
        let customerData: any = null;
        let customerError: any = null;

        if (validPhone) {
            const { data, error } = await supabase.from('Customers').select('id, fullName, notes, phone, email, createdAt').eq('phone', validPhone).maybeSingle();
            customerData = data;
            customerError = error;
        }

        if (!customerData && validEmail) {
            const { data, error } = await supabase.from('Customers').select('id, fullName, notes, phone, email, createdAt').eq('email', validEmail).maybeSingle();
            customerData = data;
            customerError = error;
        }

        if (customerError) {
            console.error('Error fetching customer:', customerError.message, customerError.code);
        }

        // 2. Tra cứu lịch sử Bookings
        let bookingQuery = supabase.from('Bookings').select('id, status, source, parent_booking_id, bookingDate, createdAt');
        
        if (customerData) {
            // Nếu đã tìm thấy khách, dùng ID của khách để tìm toàn bộ lịch sử
            bookingQuery = bookingQuery.eq('customerId', customerData.id);
        } else if (validPhone) {
            bookingQuery = bookingQuery.eq('customerPhone', validPhone);
        } else if (validEmail) {
            bookingQuery = bookingQuery.eq('customerEmail', validEmail);
        } else {
            bookingQuery = bookingQuery.eq('id', 'DO_NOT_MATCH_ANYTHING');
        }
        
        // Lấy mọi trạng thái — nhãn và số lượt tính bằng CustomerVisitService (một công thức với CRM/Dispatch).

        const { data: bookingsData, error: bookingsError } = await bookingQuery;
        if (bookingsError) {
            console.error('Error fetching bookings:', bookingsError.message, bookingsError.code);
        }

        const visit = computeProfileVisit(bookingsData || [], customerData?.createdAt || null);
        const visitCount = visit.completedVisits;
        const isReturning = visit.status === 'RETURNING';
        const bookingIds = (bookingsData || []).filter(b => COMPLETED_STATUSES.includes(String(b.status))).map(b => b.id);

        // 3. Trích xuất thói quen (nếu là khách cũ)
        let topService = '';
        let topKtv = '';
        let preferredStrength = '';

        if (isReturning && bookingIds.length > 0) {
            const { data: bookingItemsData, error: itemsError } = await supabase
                .from('BookingItems')
                .select(`
                    serviceId,
                    technicianCodes,
                    options,
                    Services!fk_bookingitems_service ( nameVN )
                `)
                .in('bookingId', bookingIds);

            if (itemsError) {
                console.error('Error fetching booking items:', itemsError.message, itemsError.code);
            }

            if (bookingItemsData && bookingItemsData.length > 0) {
                // Thống kê Service
                const serviceCount: Record<string, number> = {};
                const serviceNames: Record<string, string> = {};
                
                // Thống kê KTV
                const ktvCount: Record<string, number> = {};
                
                // Thống kê Lực massage
                const strengthCount: Record<string, number> = {};

                for (const item of bookingItemsData) {
                    // Service
                    if (item.serviceId) {
                        serviceCount[item.serviceId] = (serviceCount[item.serviceId] || 0) + 1;
                        // Handle standard join structure from Supabase
                        const serviceObj = item.Services as any;
                        if (serviceObj && serviceObj.nameVN) {
                            serviceNames[item.serviceId] = serviceObj.nameVN;
                        }
                    }

                    // KTV
                    if (Array.isArray(item.technicianCodes)) {
                        for (const ktv of item.technicianCodes) {
                            ktvCount[ktv] = (ktvCount[ktv] || 0) + 1;
                        }
                    }

                    // Options (Strength)
                    if (item.options && typeof item.options === 'object') {
                        const strength = (item.options as any).strength || (item.options as any).preferredStrength;
                        if (strength) {
                            strengthCount[strength] = (strengthCount[strength] || 0) + 1;
                        }
                    }
                }

                // Tìm max
                const getTop = (record: Record<string, number>) => {
                    return Object.entries(record).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
                };

                const topServiceId = getTop(serviceCount);
                topService = serviceNames[topServiceId] || topServiceId;
                topKtv = getTop(ktvCount);
                preferredStrength = getTop(strengthCount);
            }
        }

        // 4. Tạo câu chào (Wow Message)
        const customerName = customerData?.fullName || (phone ? `Khách hàng (${phone})` : 'Khách hàng');
        const notes = customerData?.notes || '';

        let wowMessage = '';
        let greetingSuggestion = '';

        if (visit.status === 'VISITED') {
            wowMessage = `Ting! ${customerName} đã từng tới (có hồ sơ) nhưng chưa hoàn tất lượt nào. Xác nhận lại nhu cầu giúp khách nhé!`;
            greetingSuggestion = `Dạ Oria Spa xin chào ${customerName}! Rất vui được gặp lại anh/chị, hôm nay anh/chị muốn dùng dịch vụ gì ạ?`;
        } else if (!isReturning) {
            wowMessage = `Ting! Khách mới tinh chưa có lịch sử (${customerName}). Cố gắng chốt sale và phục vụ thật tốt nhé!`;
            greetingSuggestion = `Dạ Oria Spa xin chào! Đây là lần đầu tiên ${customerName} đến với Spa đúng không ạ?`;
        } else {
            const preferencesParts = [];
            if (topService) preferencesParts.push(`hay làm ${topService}`);
            if (preferredStrength) preferencesParts.push(`thích lực ${preferredStrength}`);
            if (topKtv) preferencesParts.push(`hay chọn KTV ${topKtv}`);

            const prefString = preferencesParts.length > 0 
                ? `Khách này ${preferencesParts.join(', và ')}.` 
                : '';

            wowMessage = `Ting! Đơn mới từ Khách Cũ VIP (Đến lần ${visitCount}). ${prefString}`;
            
            let greetingParts = [];
            if (topService) greetingParts.push(`${topService}`);
            if (preferredStrength) greetingParts.push(`lực ${preferredStrength}`);
            if (topKtv) greetingParts.push(`với bạn KTV ${topKtv}`);
            
            if (greetingParts.length > 0) {
                greetingSuggestion = `Chào ${customerName}, hôm nay anh/chị vẫn làm ${greetingParts.join(' ')} đúng không ạ?`;
            } else {
                greetingSuggestion = `Chào ${customerName}, mừng anh/chị đã quay lại Oria Spa lần thứ ${visitCount + 1}! Hôm nay anh/chị muốn dùng dịch vụ gì ạ?`;
            }
        }

        return {
            isReturning,
            visitCount,
            visitStatus: visit.status,
            customer: customerData ? {
                name: customerData.fullName || '',
                phone: customerData.phone || phone || '',
                notes: customerData.notes || ''
            } : null,
            preferences: isReturning ? {
                topService,
                topKtv,
                preferredStrength
            } : null,
            wowMessage,
            greetingSuggestion
        };
    }
}
