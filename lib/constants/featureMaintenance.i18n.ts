/**
 * The ONE sentence a KTV sees whenever a feature they are PERMITTED to use has
 * been switched off by an admin — per-staff flag, type-wide switch, or the
 * "Hoạt động" account switch (manual lock).
 *
 * Rule (agreed with the owner): feature OFF while the role permission is still
 * ON → always this sentence, at every entry point. Permission OFF too → the
 * KTV simply does not have the feature; keep hiding it as before.
 *
 * Plain `.ts` (no 'use client', no Next imports) so API routes and client
 * components import the exact same string. Never hand-type this sentence
 * anywhere else — QA #15 greps for stray copies.
 */
export const FEATURE_MAINTENANCE_MESSAGE = 'Tính năng của bạn đang bảo trì';

/** Error code APIs return so the client can render the notice, not a generic error. */
export const FEATURE_MAINTENANCE_CODE = 'FEATURE_MAINTENANCE';
