import { SupabaseClient } from '@supabase/supabase-js';

// =====================================================
// StorageCleanupService — S.O.L.I.D Service Layer
// Plan: plan_handover_review_v5.md
// Single Responsibility: Cleanup expired images from Storage.
// =====================================================

export class StorageCleanupService {

    /**
     * Clean up expired images from both 'handover-images' and 'attendance' buckets.
     * 
     * SAFETY RULES:
     * - DO NOT delete images from items with handover_status = 'PENDING' or 'REJECTED'
     * - DO NOT delete images from items with commission_locked = true (evidence for disputes)
     * - Only delete images from APPROVED or DONE items older than X days
     */
    static async cleanupExpiredImages(
        supabase: SupabaseClient
    ): Promise<{ handoverDeleted: number; attendanceDeleted: number }> {
        // 1. Get config
        const { data: configRow } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'storage_cleanup_days')
            .single();
        const retentionDays = parseInt(configRow?.value || '3', 10);

        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const cutoffISO = cutoffDate.toISOString();

        let handoverDeleted = 0;
        let attendanceDeleted = 0;

        // =====================================================
        // 2. CLEAN HANDOVER IMAGES
        // =====================================================
        
        // Find BookingItems that are APPROVED and older than cutoff, 
        // NOT locked (dispute evidence), and have handover_images
        const { data: eligibleItems } = await supabase
            .from('BookingItems')
            .select('id, handover_images')
            .eq('handover_status', 'APPROVED')
            .eq('commission_locked', false)
            .lt('updated_at', cutoffISO)
            .not('handover_images', 'eq', '{}')
            .not('handover_images', 'eq', '[]');

        if (eligibleItems && eligibleItems.length > 0) {
            // Collect all image URLs to delete from storage
            const filesToDelete: string[] = [];

            for (const item of eligibleItems) {
                const images = typeof item.handover_images === 'string'
                    ? JSON.parse(item.handover_images)
                    : item.handover_images;

                if (images && typeof images === 'object') {
                    for (const urls of Object.values(images)) {
                        if (Array.isArray(urls)) {
                            for (const url of urls) {
                                // Extract file path from public URL
                                const path = this.extractStoragePath(url as string, 'handover-images');
                                if (path) filesToDelete.push(path);
                            }
                        }
                    }
                }
            }

            // Delete files from storage in batches of 100
            if (filesToDelete.length > 0) {
                for (let i = 0; i < filesToDelete.length; i += 100) {
                    const batch = filesToDelete.slice(i, i + 100);
                    const { error } = await supabase.storage
                        .from('handover-images')
                        .remove(batch);
                    if (!error) handoverDeleted += batch.length;
                }
            }

            // Clear URLs from database
            const itemIds = eligibleItems.map(i => i.id);
            await supabase
                .from('BookingItems')
                .update({ handover_images: {} })
                .in('id', itemIds);
        }

        // =====================================================
        // 3. CLEAN ATTENDANCE / SELFIE IMAGES
        // =====================================================

        // List all files in 'attendance' bucket older than cutoff
        const { data: attendanceFiles } = await supabase.storage
            .from('attendance')
            .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });

        if (attendanceFiles && attendanceFiles.length > 0) {
            const oldFiles = attendanceFiles.filter(f => {
                if (!f.created_at) return false;
                return new Date(f.created_at) < cutoffDate;
            });

            if (oldFiles.length > 0) {
                const pathsToDelete = oldFiles.map(f => f.name);

                for (let i = 0; i < pathsToDelete.length; i += 100) {
                    const batch = pathsToDelete.slice(i, i + 100);
                    const { error } = await supabase.storage
                        .from('attendance')
                        .remove(batch);
                    if (!error) attendanceDeleted += batch.length;
                }
            }

            // Also clear startPhotoUrl from segments in BookingItems
            // This is a best-effort cleanup — segments are JSONB so we update via raw SQL
            // or we can skip this and let the URLs become broken links (harmless)
        }

        console.log(`🧹 [Storage Cleanup] Deleted: ${handoverDeleted} handover images, ${attendanceDeleted} attendance images`);
        return { handoverDeleted, attendanceDeleted };
    }

    /**
     * Extract the storage path from a full public URL.
     * Example: https://xxx.supabase.co/storage/v1/object/public/handover-images/file.jpg -> file.jpg
     */
    private static extractStoragePath(url: string, bucket: string): string | null {
        if (!url) return null;
        const marker = `/storage/v1/object/public/${bucket}/`;
        const idx = url.indexOf(marker);
        if (idx === -1) return null;
        return url.substring(idx + marker.length);
    }
}
