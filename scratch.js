const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val) acc[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
    return acc;
}, {});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function testBonus(techCode) {
    const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // 1. Fetch bookings
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, timeEnd, status, technicianCode, rating, billCode,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, "technicianCodes", segments, "itemRating", "ktvRatings" )
        `)
        .gte('timeStart', `${todayStr}T00:00:00+07:00`)
        .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

    const timeline = [];
    const basePointsForShift = 20; // Giả sử ca này base = 20

    (bookings || []).forEach(b => {
        let isInvovled = false;
        const allKtvCodes = new Set();
        for (const item of (b.BookingItems || [])) {
            if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                item.technicianCodes.forEach(tc => {
                    allKtvCodes.add(tc.toLowerCase());
                    if (tc.toLowerCase() === techCode.toLowerCase()) isInvovled = true;
                });
            }
        }
        
        if (isInvovled) {
            let maxKtvRating = 0;
            for (const item of (b.BookingItems || [])) {
                const isTechInvolved = item.technicianCodes && Array.isArray(item.technicianCodes) &&
                    item.technicianCodes.some(tc => tc.toLowerCase() === techCode.toLowerCase());
                
                if (isTechInvolved) {
                    let ktvRating = 0;
                    let parsedKtvRatings = item.ktvRatings;
                    if (typeof parsedKtvRatings === 'string') {
                        try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
                    }
                    if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                        const key = Object.keys(parsedKtvRatings).find(k => k.toLowerCase() === techCode.toLowerCase());
                        if (key) {
                            ktvRating = Number(parsedKtvRatings[key]) || 0;
                        }
                    }
                    if (ktvRating === 0) {
                        ktvRating = Number(item.itemRating) || 0;
                    }
                    if (ktvRating === 0) {
                        ktvRating = Number(b.rating) || 0;
                    }
                    if (ktvRating > maxKtvRating) {
                        maxKtvRating = ktvRating;
                    }
                }
            }

            console.log(`[Tech ${techCode}] Booking ${b.billCode} has maxKtvRating: ${maxKtvRating}`);

            if (maxKtvRating >= 4) {
                let totalDuration = 0;
                for (const item of (b.BookingItems || [])) {
                    let segs = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                    
                    const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
                    if (mySegs.length > 0) {
                        totalDuration += mySegs.reduce((sum, seg) => {
                            return sum + (Number(seg.duration) || 0);
                        }, 0);
                    } else if (item.technicianCodes && item.technicianCodes.some(tc => tc.toLowerCase() === techCode.toLowerCase())) {
                        totalDuration += 60;
                    }
                }

                let adjustedBasePoints = basePointsForShift;
                if (totalDuration < 60) adjustedBasePoints = adjustedBasePoints / 2;
                const bonusPts = Math.floor(adjustedBasePoints / (allKtvCodes.size || 1));
                
                if (bonusPts > 0) {
                    timeline.push({
                        billCode: b.billCode,
                        points: bonusPts,
                        rating: maxKtvRating
                    });
                }
            }
        }
    });

    console.log(`[Tech ${techCode}] Earned Bonus Timeline today:`, timeline);
}

async function run() {
    await testBonus('NH011');
    await testBonus('NH021');
}
run();
