import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getSessionAccess } from '@/lib/auth-server';
import { PROMOTION_ERROR_HTTP_STATUS, promotionCan, type PromotionAction } from '@/lib/constants/promotion';
import type { PromotionResult } from '@/lib/types/promotion';

// Shared plumbing for /api/**/promotion* routes: auth, body validation, and
// mapping PromotionResult -> HTTP. Response body is always
// { success: true, data } | { success: false, error: { code, message }, data? }.

const authFailure = (status: 401 | 403 | 423) => NextResponse.json({
    success: false,
    error: status === 401 ? { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập lại' }
        : status === 423 ? { code: 'ACCOUNT_LOCKED', message: 'Tài khoản đang bị khoá' }
        : { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này' },
}, { status });

export interface PromotionAuth {
    staffId: string;
    /** Same table as the guard — e.g. auth.can('apply.override'), auth.can('customer.pii'). */
    can: (action: PromotionAction) => boolean;
}

/**
 * Guard for every promotion route: a real session is ALWAYS required (independent of
 * AUTH_ENFORCE_API), then the action must be allowed by PROMOTION_ACTION_PERMISSIONS.
 * Who holds which permission is configured by the admin (Roles page → Users.permissions).
 */
export async function authorizePromotion(action: PromotionAction): Promise<PromotionAuth | Response> {
    const access = await getSessionAccess();
    if (access.status === 'LOCKED') return authFailure(423);
    if (access.status !== 'OK') return authFailure(401);
    const can = (a: PromotionAction) => promotionCan(access.permissions, a);
    if (!can(action)) return authFailure(403);
    return { staffId: access.techCode || access.businessUserId, can };
}

export function promotionJson<T>(result: PromotionResult<T>, successStatus = 200) {
    if (result.success) return NextResponse.json(result, { status: successStatus });
    const status = PROMOTION_ERROR_HTTP_STATUS[result.error.code] ?? 400;
    return NextResponse.json(result, { status });
}

export async function parsePromotionBody<S extends z.ZodTypeAny>(request: Request, schema: S)
    : Promise<{ data: z.infer<S> } | Response> {
    const raw = await request.json().catch(() => undefined);
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        return NextResponse.json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Dữ liệu không hợp lệ',
                data: {
                    field: first?.path.join('.') || null,
                    issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
                },
            },
        }, { status: 400 });
    }
    return { data: parsed.data };
}

export const promotionInternalError = (e: unknown) => NextResponse.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: (e as Error)?.message || 'Internal error' } },
    { status: 500 });
