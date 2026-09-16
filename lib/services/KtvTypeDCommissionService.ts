export class KtvTypeDCommissionService {
    /**
     * Calculate total commission for a set of booking items assigned to a single guest.
     * @param bookingItems Array of items for this KTV for a specific guest
     * @param techCode The KTV's employee ID
     * @param guestRating Rating given by the guest (0-4★ scale)
     * @param ratePer60m Rate per 60 minutes (e.g. 100000 for PT, 180000 for VIP)
     * @param ratingDeductions Deduction map e.g. { "4": 0, "3": 0.25, "2": 0.5, "1": 0.75, "0": 0 }
     */
    static calculateGuestCommission(
        bookingItems: any[],
        techCode: string,
        guestRating: number | null | undefined,
        ratePer60m: number,
        ratingDeductions: Record<string, number>
    ): number {
        const safeRating = guestRating ?? 0;
        const deductionStr = safeRating.toString();
        const d = ratingDeductions[deductionStr] ?? 0;

        let totalPay = 0;

        for (const item of bookingItems) {
            let segsArray = [];
            if (typeof item.segments === 'string') {
                try {
                    segsArray = JSON.parse(item.segments);
                } catch (e) {
                    console.error('Failed to parse segments JSON string:', e);
                    segsArray = [];
                }
            } else {
                segsArray = item.segments || [];
            }
            
            const mySegs = segsArray.filter((s: any) => 
                s.ktvId && s.ktvId.toLowerCase() === techCode.toLowerCase()
            );
            
            for (const seg of mySegs) {
                // 1. Admin can thiệp tay
                if (seg.customCommissionDuration !== undefined && seg.customCommissionDuration !== null) {
                    const customPhut = Number(seg.customCommissionDuration);
                    totalPay += customPhut * (ratePer60m / 60);
                    continue;
                }

                const gan = Number(seg.duration) || 0;
                let phut = 0;

                // 2. Quầy bấm dừng sớm -> có actualEndTime
                if (seg.actualStartTime && seg.actualEndTime) {
                    const t1 = new Date(seg.actualStartTime).getTime();
                    const t2 = new Date(seg.actualEndTime).getTime();
                    const thuc = Math.max(0, (t2 - t1) / 60000); // in minutes
                    phut = Math.min(thuc, gan);
                } 
                // 3. Tua diễn ra bình thường không bị dừng (hoặc thiếu timestamp)
                else {
                    phut = gan; // Mặc định làm đủ giờ gán
                }

                const basePay = phut * (ratePer60m / 60);
                totalPay += basePay;
            }
        }

        const finalPay = totalPay * (1 - d);
        return Math.round(finalPay);
    }
}
