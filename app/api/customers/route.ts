import { parseDbDate } from "@/lib/utils";
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CustomerPatchSchema } from '@/lib/schemas/crm.schema';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Helper to bypass 1000 limit
        async function fetchAll(tableName: string, selectStr: string, buildQuery: (q: any) => any = (q) => q) {
            let allData: any[] = [];
            let from = 0;
            const limit = 1000;
            
            while (true) {
                let query = supabase!.from(tableName).select(selectStr).range(from, from + limit - 1);
                query = buildQuery(query);
                
                const { data, error } = await query;
                if (error) throw error;
                if (!data || data.length === 0) break;
                
                allData = allData.concat(data);
                if (data.length < limit) break;
                from += limit;
            }
            return allData;
        }

        // 1. Fetch all customers
        let customers: any[];
        try {
            customers = await fetchAll('Customers', '*', q => q.order('fullName', { ascending: true }));
        } catch (cError) {
            console.error('Error fetching customers:', cError);
            return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
        }

        if (!customers || customers.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // 2. Fetch all completed bookings (to calculate stats)
        let allBookings: any[];
        try {
            allBookings = await fetchAll('Bookings', `
                id, customerId, customerName, customerEmail, customerLang, status, bookingDate, totalAmount, createdAt, notes, source, guestCount, customerGender,
                BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, options )
            `, q => q.in('status', ['COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING']));
        } catch (bError) {
            console.error('Error fetching bookings for stats:', bError);
            return NextResponse.json({ success: true, data: customers }); // Return without stats gracefully
        }

        // Fetch Services and Staff for mapping
        const [{ data: services }, { data: staff }] = await Promise.all([
            supabase!.from('Services').select('id, nameVN, duration'),
            supabase!.from('Staff').select('code, name')
        ]);
        
        const serviceMap = new Map((services || []).map(s => [s.id, s.nameVN || 'Unknown']));
        const serviceDurationMap = new Map((services || []).map(s => [s.id, s.duration || 0]));
        const staffMap = new Map((staff || []).map(s => [s.code, s.name || 'Unknown']));

        // 3. Create Maps for grouping bookings by customerId AND email
        const bookingsByCustomerId = new Map<string, any[]>();
        // Key = "normalizedName|normalizedEmail" — same person = same name + same email
        const bookingsByNameEmail = new Map<string, any[]>();

        (allBookings || []).forEach(b => {
            if (b.customerId) {
                if (!bookingsByCustomerId.has(b.customerId)) {
                    bookingsByCustomerId.set(b.customerId, []);
                }
                bookingsByCustomerId.get(b.customerId)?.push(b);
            }
            if (b.customerEmail && b.customerEmail.includes('@') && b.customerName) {
                const compositeKey = `${(b.customerName || '').toLowerCase().trim()}|${b.customerEmail.toLowerCase().trim()}`;
                if (!bookingsByNameEmail.has(compositeKey)) {
                    bookingsByNameEmail.set(compositeKey, []);
                }
                bookingsByNameEmail.get(compositeKey)?.push(b);
            }
        });

        // 4. Pre-process formats
        const vnDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
        const vnHourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false });
        
        const now = new Date();
        const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

        // 5. Aggregate data per customer
        const enrichedCustomers = customers.map(customer => {
            // Get bookings by ID or by Name+Email composite key
            const byId = customer.id ? bookingsByCustomerId.get(customer.id) || [] : [];
            const compositeKey = customer.fullName && customer.email
                ? `${customer.fullName.toLowerCase().trim()}|${customer.email.toLowerCase().trim()}`
                : '';
            const byNameEmail = compositeKey ? bookingsByNameEmail.get(compositeKey) || [] : [];
            
            // Filter byId: only keep bookings where customerName matches this customer
            // Manager often reuses one customer account for many different people
            const custNameNorm = (customer.fullName || '').toLowerCase().trim();
            const filteredById = byId.filter(b => {
                const bName = (b.customerName || '').toLowerCase().trim();
                // Match if: no name on booking, names are equal, or one contains the other
                return !bName || !custNameNorm || bName === custNameNorm 
                    || bName.includes(custNameNorm) || custNameNorm.includes(bName);
            });
            
            // Combine and deduplicate bookings by ID
            const combinedBookings = [...filteredById];
            const existingIds = new Set(combinedBookings.map(b => b.id));
            
            byNameEmail.forEach(b => {
                if (!existingIds.has(b.id)) {
                    combinedBookings.push(b);
                }
            });
            
            const visitCount = combinedBookings.length;
            const totalSpent = combinedBookings.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);
            
            // --- BẮT ĐẦU TÍNH TOÁN CÁC CHỈ SỐ V9 ---
            let vipMenuCount = 0;
            const usedSources = new Set<string>();
            const timeFrames: Record<string, number> = {};
            const serviceCounts: Record<string, number> = {};
            const ktvCounts: Record<string, number> = {};
            const strengthCounts: Record<string, number> = {};
            const langCounts: Record<string, number> = {};
            const genderReqCounts: Record<string, number> = {};
            let visitsLast30Days = 0;
            let visitsLast7Days = 0;
            
            const unique7Days = new Set<string>();
            const unique30Days = new Set<string>();

            const ktvReviews: string[] = [];

            combinedBookings.forEach(b => {
                // Đánh giá KTV (từ notes)
                if (b.notes && b.notes.includes('[Đánh giá KTV:')) {
                    const matches = b.notes.match(/\[Đánh giá KTV: (.*?)\]/g);
                    if (matches) {
                        matches.forEach((m: string) => {
                            const raw = m.replace('[Đánh giá KTV: ', '').replace(']', '');
                            raw.split(',').forEach(tag => ktvReviews.push(tag.trim()));
                        });
                    }
                }

                // Nguồn đơn hàng & VIP Menu
                if (b.source) {
                    usedSources.add(b.source);
                    if (b.source.toUpperCase().includes('VIP')) {
                        vipMenuCount++;
                    }
                }

                // Ngôn ngữ khách hàng
                if (b.customerLang) {
                    const lang = b.customerLang.toLowerCase().trim();
                    if (lang) langCounts[lang] = (langCounts[lang] || 0) + 1;
                }

                // Khung giờ (Múi giờ Việt Nam) — dùng createdAt khi bookingDate không có giờ thực
                // bookingDate dạng '2026-07-08T00:00:00' (midnight) là đơn walk-in, không có giờ thực
                const rawDate = b.bookingDate || '';
                const isMidnight = rawDate.includes('T00:00:00') || rawDate.match(/^\d{4}-\d{2}-\d{2}$/);
                const timeSource = isMidnight && b.createdAt ? b.createdAt : rawDate;
                const safeDateStr = timeSource ? (timeSource.endsWith('Z') ? timeSource : timeSource + 'Z') : '';
                if (safeDateStr) {
                    const bDate = new Date(safeDateStr);
                    if (!isNaN(bDate.getTime())) {
                        const hour = parseInt(vnHourFormatter.format(bDate), 10);
                        const frame = `${hour}h-${hour + 1}h`;
                        timeFrames[frame] = (timeFrames[frame] || 0) + 1;
                        
                        // Tính số ngày đến gần nhất
                        const bTime = bDate.getTime();
                        const dateStr = vnDateFormatter.format(bDate);
                        if (bTime >= thirtyDaysAgo) unique30Days.add(dateStr);
                        if (bTime >= sevenDaysAgo) unique7Days.add(dateStr);
                    }
                }

                // Dịch vụ và KTV thường làm (từ BookingItems)
                if (b.BookingItems && Array.isArray(b.BookingItems)) {
                    b.BookingItems.forEach((item: any) => {
                        // Exclude "Phòng riêng" (NHS0900) and split items (tách đơn cho 2 KTV)
                        if (item.serviceId && item.serviceId !== 'NHS0900' && !(item.options && item.options.isSplitItem)) {
                            serviceCounts[item.serviceId] = (serviceCounts[item.serviceId] || 0) + 1;
                        }
                        if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                            item.technicianCodes.forEach((code: string) => {
                                ktvCounts[code] = (ktvCounts[code] || 0) + 1;
                            });
                        }
                        // Lực massage ưa thích
                        if (item.options && item.options.strength) {
                            const rawStr = item.options.strength.trim();
                            if (rawStr) {
                                const val = rawStr.toLowerCase();
                                const mapped = val === 'medium' || val === 'vừa' ? 'Vừa'
                                             : val === 'strong' || val === 'mạnh' ? 'Mạnh'
                                             : val === 'light' || val === 'soft' || val === 'nhẹ' ? 'Nhẹ'
                                             : rawStr;
                                strengthCounts[mapped] = (strengthCounts[mapped] || 0) + 1;
                            }
                        }
                        // Giới tính KTV yêu cầu (therapist field)
                        if (item.options && item.options.therapist) {
                            const g = item.options.therapist.trim();
                            if (g && g !== 'Ngẫu nhiên') genderReqCounts[g] = (genderReqCounts[g] || 0) + 1;
                        }
                    });
                }
            });

            const uniqueKtvReviews = Array.from(new Set(ktvReviews)).filter(Boolean);
            
            // Tìm Khung giờ, Dịch vụ, KTV nhiều nhất
            let mostFrequentTimeFrame = 'N/A';
            let maxFrame = 0;
            for (const [frame, count] of Object.entries(timeFrames)) {
                if (count > maxFrame) { maxFrame = count; mostFrequentTimeFrame = frame; }
            }

            let topServiceId = null;
            let maxService = 0;
            for (const [sId, count] of Object.entries(serviceCounts)) {
                if (count > maxService) { maxService = count; topServiceId = sId; }
            }
            const topService = topServiceId ? serviceMap.get(topServiceId) : 'N/A';

            // Dịch vụ thường dùng - (Không giới hạn >= 2 lần, nếu > 1 lần thì thêm số lần)
            const frequentServices = Object.entries(serviceCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([sId, count]) => {
                    const name = serviceMap.get(sId) || sId;
                    const dur = serviceDurationMap.get(sId);
                    const durStr = dur ? ` ${dur}p` : '';
                    return count > 1 ? `${name}${durStr} (${count} lần)` : `${name}${durStr}`;
                }); // Returns array

            let topKtvCode = null;
            let maxKtv = 0;
            const allKtvs = [];
            for (const [code, count] of Object.entries(ktvCounts)) {
                allKtvs.push(staffMap.get(code) || code);
                if (count > maxKtv) { maxKtv = count; topKtvCode = code; }
            }
            const topKtv = topKtvCode ? staffMap.get(topKtvCode) : 'N/A';
            const allKtvsStr = [...new Set(allKtvs)].join(', ');

            // KTV thường làm - (Không giới hạn >= 2 lần, nếu > 1 lần thì thêm số lần)
            const frequentKtvs = Object.entries(ktvCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([code, count]) => {
                    const name = staffMap.get(code) || code;
                    return count > 1 ? `${name} (${count} lần)` : name;
                }); // Returns array

            // Lực massage ưa thích (mode)
            let preferredStrength = 'N/A';
            let maxStr = 0;
            for (const [str, count] of Object.entries(strengthCounts)) {
                if (count > maxStr) { maxStr = count; preferredStrength = str; }
            }

            // Ngôn ngữ ưa thích
            const LANG_MAP: Record<string, string> = { en: 'EN English', vi: 'VN Tiếng Việt', jp: 'JP 日本語', cn: 'CN 中文', kr: 'KR 한국어' };
            let preferredLang = 'N/A';
            let preferredLangCode = 'vi';
            let maxLang = 0;
            for (const [lang, count] of Object.entries(langCounts)) {
                if (count > maxLang) { 
                    maxLang = count; 
                    preferredLangCode = lang;
                    preferredLang = LANG_MAP[lang] || lang; 
                }
            }
            
            // Giới tính khách hàng: ưu tiên DB > Bookings.customerGender > therapist preference
            const GENDER_DISPLAY: Record<string, string> = { 'male': 'Nam', 'female': 'Nữ' };
            let preferredGender = customer.gender 
                ? (GENDER_DISPLAY[customer.gender] || customer.gender)
                : null;
            
            // Fallback 1: từ Bookings.customerGender (mới nhất)
            if (!preferredGender) {
                const latestGender = combinedBookings
                    .filter((b: any) => b.customerGender)
                    .sort((a: any, b: any) => new Date(b.bookingDate || 0).getTime() - new Date(a.bookingDate || 0).getTime())[0]?.customerGender;
                if (latestGender) preferredGender = GENDER_DISPLAY[latestGender] || latestGender;
            }

            // Fallback 2: suy từ yêu cầu KTV (options.therapist) trong BookingItems
            if (!preferredGender && Object.keys(genderReqCounts).length > 0) {
                const topGender = Object.entries(genderReqCounts)
                    .sort((a, b) => b[1] - a[1])[0][0];
                preferredGender = topGender; // "Nữ" hoặc "Nam"
            }

            visitsLast30Days = unique30Days.size;
            visitsLast7Days = unique7Days.size;
            // --- KẾT THÚC TÍNH TOÁN ---

            // Find most recent visit
            let lastBooking = null;
            if (combinedBookings.length > 0) {
                lastBooking = combinedBookings.reduce((latest, current) => {
                    const latestTime = latest.bookingDate ? new Date(latest.bookingDate.endsWith('Z') ? latest.bookingDate : latest.bookingDate + 'Z').getTime() : 0;
                    const currentTime = current.bookingDate ? new Date(current.bookingDate.endsWith('Z') ? current.bookingDate : current.bookingDate + 'Z').getTime() : 0;
                    return currentTime > latestTime ? current : latest;
                });
            }

            // Determine guest type, guest count and nationality
            const maxGuestCount = Math.max(...combinedBookings.map(b => b.guestCount || 1), 1);
            const isGroup = maxGuestCount > 1;
            const guestType = isGroup ? 'Khách nhóm' : 'Khách lẻ';
            
            // Try to get nationality from latest booking if missing on customer profile
            let resolvedNationality = customer.nationality;
            if (!resolvedNationality && lastBooking && lastBooking.nationality) {
                 resolvedNationality = lastBooking.nationality;
            }

            return {
                ...customer,
                nationality: resolvedNationality || '',
                guestType,
                maxGuestCount,
                visitCount,
                totalSpent,
                ktvReviews: uniqueKtvReviews,
                lastVisited: lastBooking ? (lastBooking.bookingDate || lastBooking.createdAt) : customer.lastVisited,
                frequentTimeFrame: mostFrequentTimeFrame,
                usedSources: Array.from(usedSources).join(', ') || 'N/A',
                vipMenuCount,
                topService,
                frequentServices,
                topKtv,
                frequentKtvs,
                allKtvs: allKtvsStr,
                preferredStrength,
                preferredLang,
                preferredLangCode,
                preferredGender,
                visitsLast30Days,
                visitsLast7Days
            };
        });

        return NextResponse.json({ success: true, data: enrichedCustomers });
    } catch (error: any) {
        console.error('API Error (Customers):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const parseResult = CustomerPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { id, notes, gender, nationality, preferredLang } = parseResult.data;

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase not initialized');

        // Build update payload — only include fields that are provided
        const updatePayload: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (notes !== undefined) updatePayload.notes = notes;
        if (gender !== undefined) updatePayload.gender = gender;
        if (nationality !== undefined) updatePayload.nationality = nationality;

        const { data, error } = await supabase
            .from('Customers')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // If preferredLang is updated, sync it to Bookings customerLang
        if (preferredLang !== undefined && preferredLang !== null) {
            const { error: bError } = await supabase
                .from('Bookings')
                .update({ customerLang: preferredLang })
                .eq('customerId', id);
            if (bError) {
                console.error('Error updating customerLang in Bookings:', bError);
            }
        }

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('API Error (Customers PATCH):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
