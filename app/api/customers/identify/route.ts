import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { COMPLETED_STATUSES, isReturningCustomer, isDummyPhone, isDummyEmail } from '@/lib/customer.logic';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone') || '';
        const email = searchParams.get('email') || '';

        const validPhone = !isDummyPhone(phone) ? phone : null;
        const validEmail = !isDummyEmail(email) ? email : null;

        if (!validPhone && !validEmail) {
            // Nếu cả phone và email đều là dummy, trả về luôn Khách Mới
            return NextResponse.json({
                success: true,
                data: {
                    isReturning: false,
                    visitCount: 0,
                    guestType: 'Khách Mới',
                    customerName: 'Khách Vãng Lai',
                    notes: ''
                }
            });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Lỗi kết nối cơ sở dữ liệu' }, { status: 500 });
        }

        // 1. Tra cứu Customer
        let customerQuery = supabase.from('Customers').select('id, fullName, phone, email, notes');
        if (validPhone) {
            customerQuery = customerQuery.eq('phone', validPhone);
        } else if (validEmail) {
            customerQuery = customerQuery.eq('email', validEmail);
        }

        const { data: customers, error: custError } = await customerQuery.limit(1);
        if (custError) {
            console.error('Lỗi khi tra cứu khách hàng:', custError);
            return NextResponse.json({ success: false, error: 'Lỗi tra cứu cơ sở dữ liệu' }, { status: 500 });
        }

        const customer = customers && customers.length > 0 ? customers[0] : null;

        // 2. Đếm Lịch sử (Bookings)
        let bookingsQuery = supabase.from('Bookings').select(`
            id, status, customerName,
            BookingItems (
                serviceId, technicianCodes, options
            )
        `).in('status', COMPLETED_STATUSES);

        if (customer) {
            bookingsQuery = bookingsQuery.eq('customerId', customer.id);
        } else if (validPhone) {
            bookingsQuery = bookingsQuery.eq('customerPhone', validPhone);
        } else if (validEmail) {
            bookingsQuery = bookingsQuery.eq('customerEmail', validEmail);
        }

        const { data: bookings, error: bookingsError } = await bookingsQuery;
        if (bookingsError) {
            console.error('Lỗi khi tải lịch sử bookings:', bookingsError);
            return NextResponse.json({ success: false, error: 'Lỗi truy vấn lịch sử' }, { status: 500 });
        }

        const visitCount = bookings ? bookings.length : 0;
        const isReturning = isReturningCustomer(visitCount);

        // 3. Trích xuất Thói quen (BookingItems)
        let topService = '';
        let topKtv = '';
        let preferredStrength = '';

        if (isReturning && bookings) {
            const serviceCounts: Record<string, number> = {};
            const ktvCounts: Record<string, number> = {};
            const strengthCounts: Record<string, number> = {};

            bookings.forEach(b => {
                if (b.BookingItems && Array.isArray(b.BookingItems)) {
                    b.BookingItems.forEach((item: any) => {
                        // Đếm KTV
                        if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                            item.technicianCodes.forEach((code: string) => {
                                ktvCounts[code] = (ktvCounts[code] || 0) + 1;
                            });
                        }
                        // Đếm Dịch vụ
                        if (item.serviceId) {
                            serviceCounts[item.serviceId] = (serviceCounts[item.serviceId] || 0) + 1;
                        }
                        // Đếm Lực (Strength) - Cố gắng trích xuất từ options
                        if (item.options) {
                            try {
                                const opts = typeof item.options === 'string' ? JSON.parse(item.options) : item.options;
                                if (Array.isArray(opts)) {
                                    opts.forEach((opt: string) => {
                                        if (opt && typeof opt === 'string' && opt.toLowerCase().includes('lực')) {
                                            strengthCounts[opt] = (strengthCounts[opt] || 0) + 1;
                                        }
                                    });
                                } else if (opts && typeof opts === 'object') {
                                    if (opts.strength) {
                                        strengthCounts[opts.strength] = (strengthCounts[opts.strength] || 0) + 1;
                                    }
                                }
                            } catch (e) {
                                // Bỏ qua lỗi parse
                            }
                        }
                    });
                }
            });

            // Tìm KTV nhiều nhất
            let maxKtvCount = 0;
            for (const [code, count] of Object.entries(ktvCounts)) {
                if (count > maxKtvCount) {
                    maxKtvCount = count;
                    topKtv = code;
                }
            }

            // Tìm Dịch vụ nhiều nhất
            let maxServiceCount = 0;
            let topServiceId = '';
            for (const [id, count] of Object.entries(serviceCounts)) {
                if (count > maxServiceCount) {
                    maxServiceCount = count;
                    topServiceId = id;
                }
            }

            if (topServiceId) {
                const { data: serviceData } = await supabase.from('Services').select('nameVN').eq('id', topServiceId).single();
                if (serviceData && serviceData.nameVN) {
                    topService = serviceData.nameVN;
                }
            }

            // Tìm Lực yêu thích nhất
            let maxStrengthCount = 0;
            for (const [strength, count] of Object.entries(strengthCounts)) {
                if (count > maxStrengthCount) {
                    maxStrengthCount = count;
                    preferredStrength = strength;
                }
            }
        }

        // Lấy tên thật của KTV
        if (topKtv) {
            const { data: ktvData } = await supabase.from('Staff').select('name').eq('code', topKtv).single();
            if (ktvData && ktvData.name) {
                topKtv = ktvData.name;
            }
        }

        const cName = customer?.fullName || (bookings && bookings.length > 0 ? bookings[0].customerName : 'Anh/Chị');

        // 4. Tạo thông điệp "Wow" (Greeting Suggestion)
        let wowMessage = '';
        let greetingSuggestion = '';

        if (isReturning) {
            const vipPrefix = visitCount >= 10 ? 'VIP ' : '';
            wowMessage = `Ting! Đơn mới từ Khách Cũ ${vipPrefix}(Đến lần ${visitCount}).`;
            
            let habits = [];
            if (topService) habits.push(`hay làm ${topService}`);
            if (preferredStrength) habits.push(`thích ${preferredStrength.toLowerCase()}`);
            if (topKtv) habits.push(`hay chọn KTV ${topKtv}`);
            
            if (habits.length > 0) {
                wowMessage += ` Khách này ${habits.join(', ')}.`;
            }

            greetingSuggestion = `Chào ${cName}, hôm nay anh/chị vẫn làm ${topService || 'dịch vụ như cũ'}`;
            if (preferredStrength) {
                greetingSuggestion += ` ${preferredStrength.toLowerCase()}`;
            }
            if (topKtv) {
                greetingSuggestion += ` với bạn ${topKtv}`;
            }
            greetingSuggestion += ` đúng không ạ?`;
        } else {
            wowMessage = "Ting! Có đơn mới từ Khách Mới. Hãy tư vấn nhiệt tình nhé!";
            greetingSuggestion = `Dạ Ngan Ha Spa xin chào! Đây là lần đầu tiên ${cName} đến spa, mời ${cName} tham khảo menu dịch vụ ạ.`;
        }

        return NextResponse.json({
            success: true,
            data: {
                isReturning,
                visitCount,
                customer: customer ? {
                    name: customer.fullName,
                    phone: customer.phone,
                    notes: customer.notes
                } : null,
                preferences: {
                    topService: topService || null,
                    topKtv: topKtv || null,
                    preferredStrength: preferredStrength || null
                },
                wowMessage,
                greetingSuggestion
            }
        });

    } catch (error) {
        console.error('Error in identify API:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
