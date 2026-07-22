import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

interface CustomerIdentifyParams {
    phone?: string;
    email?: string;
}

interface CustomerIdentifyResult {
    isReturning: boolean;
    visitCount: number;
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

        // 1. Tra cứu thông tin Khách hàng
        let customerQuery = supabase.from('Customers').select('fullName, notes, phone, email');
        if (phone) {
            customerQuery = customerQuery.eq('phone', phone);
        } else if (email) {
            customerQuery = customerQuery.eq('email', email);
        }

        const { data: customerData, error: customerError } = await customerQuery.maybeSingle();
        if (customerError) {
            console.error('Error fetching customer:', customerError.message, customerError.code);
        }

        // 2. Tra cứu lịch sử Bookings
        let bookingQuery = supabase.from('Bookings').select('id');
        if (phone) {
            bookingQuery = bookingQuery.eq('customerPhone', phone);
        } else if (email) {
            bookingQuery = bookingQuery.eq('customerEmail', email);
        }
        
        // Cân nhắc các trạng thái đã phục vụ xong (COMPLETED, FEEDBACK, CLEANING, DONE)
        bookingQuery = bookingQuery.in('status', ['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE']);

        const { data: bookingsData, error: bookingsError } = await bookingQuery;
        if (bookingsError) {
            console.error('Error fetching bookings:', bookingsError.message, bookingsError.code);
        }

        const visitCount = bookingsData ? bookingsData.length : 0;
        const isReturning = visitCount > 1;
        const bookingIds = bookingsData?.map(b => b.id) || [];

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
                    Services ( nameVN )
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

        if (!isReturning) {
            wowMessage = `Ting! Khách mới tinh chưa có lịch sử (${customerName}). Cố gắng chốt sale và phục vụ thật tốt nhé!`;
            greetingSuggestion = `Dạ Ngan Ha Spa xin chào! Đây là lần đầu tiên ${customerName} đến với Spa đúng không ạ?`;
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
                greetingSuggestion = `Chào ${customerName}, mừng anh/chị đã quay lại Ngan Ha Spa lần thứ ${visitCount + 1}! Hôm nay anh/chị muốn dùng dịch vụ gì ạ?`;
            }
        }

        return {
            isReturning,
            visitCount,
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
