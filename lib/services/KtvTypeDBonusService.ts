export class KtvTypeDBonusService {
    /**
     * Calculate bonus for a guest's booking.
     * @param ktvWorkTypes Array of work_types for all KTVs that served this guest (e.g. ['TYPE_D', 'TYPE_D'])
     * @param guestRating Rating given by the guest (0-4★ scale)
     * @param basePoints Configured points for >=4★ (e.g. 20)
     * @param pointRate Configured VND per point (e.g. 1000)
     * @returns VND value of the bonus for EACH Type D KTV
     */
    static calculateBonusForTypeD(
        ktvWorkTypes: string[],
        guestRating: number | null | undefined,
        basePoints: number,
        pointRate: number
    ): number {
        // If there is any KTV that is not TYPE_D, no bonus for this guest's services.
        const hasOtherType = ktvWorkTypes.some(t => t !== 'TYPE_D');
        if (hasOtherType) return 0;

        const safeRating = guestRating ?? 0;
        // 5 is treated as >= 4, just in case old scale bleeds in
        if (safeRating < 4) return 0;

        const dCount = ktvWorkTypes.filter(t => t === 'TYPE_D').length;
        if (dCount === 0) return 0;

        const totalBonusValue = basePoints * pointRate;
        return totalBonusValue / dCount;
    }
}
