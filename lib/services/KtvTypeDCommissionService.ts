import { computeMinutes } from './KtvDLedgerEngine';

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
            
            // Use the ledger's duration rules for legacy daily-ledger callers too.
            totalPay += computeMinutes(mySegs).paid * (ratePer60m / 60);
        }

        const finalPay = totalPay * (1 - d);
        return Math.round(finalPay);
    }
}
