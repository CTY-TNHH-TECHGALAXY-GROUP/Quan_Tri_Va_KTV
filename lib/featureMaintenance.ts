import { ApiError } from '@/lib/apiClient';
import {
    FEATURE_MAINTENANCE_CODE,
    FEATURE_MAINTENANCE_MESSAGE,
} from '@/lib/constants/featureMaintenance.i18n';

/**
 * JSON body for a 403 "feature under maintenance" response. Routes wrap it in
 * `NextResponse.json(featureMaintenanceBody(), { status: 403 })`.
 */
export function featureMaintenanceBody() {
    return {
        success: false,
        code: FEATURE_MAINTENANCE_CODE,
        error: FEATURE_MAINTENANCE_MESSAGE,
    };
}

/**
 * Codes that mean "an admin switched this off" rather than a real failure.
 * `WALLET_DISABLED` predates the shared code; its message is already the
 * maintenance sentence (see `walletDisabledMessage`).
 */
const MAINTENANCE_CODES = new Set([FEATURE_MAINTENANCE_CODE, 'WALLET_DISABLED']);

/**
 * Did this request fail because the feature is switched off?
 *
 * Callers use it to show the maintenance notice INSTEAD of an empty state or a
 * generic "Lỗi kết nối" — swallowing it makes the screen look like the KTV
 * simply has no data (e.g. History showing 0đ and "Chưa có đơn hàng nào.").
 */
export function isFeatureMaintenanceError(err: unknown): boolean {
    return err instanceof ApiError && !!err.code && MAINTENANCE_CODES.has(err.code);
}
