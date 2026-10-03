import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { requireBusinessUser, requirePermission } from '@/lib/auth-server';
import { PROMOTION_ERROR_HTTP_STATUS } from '@/lib/constants/promotion';
import type { PromotionResult } from '@/lib/types/promotion';

// Shared plumbing for /api/**/promotion* routes: auth, body validation, and
// mapping PromotionResult -> HTTP. Response body is always
// { success: true, data } | { success: false, error: { code, message }, data? }.

export const PROMOTION_ADMIN_PERMISSION = 'promotions';
export const PROMOTION_COUNTER_PERMISSION = 'dispatch_board';

const authFailure = (e: unknown): Response => {
    const msg = (e as Error)?.message;
    const [code, status, message] =
        msg === 'Forbidden' ? ['FORBIDDEN', 403, 'Bạn không có quyền thực hiện thao tác này']
        : msg === 'ACCOUNT_LOCKED' ? ['ACCOUNT_LOCKED', 423, 'Tài khoản đang bị khoá']
        : ['UNAUTHORIZED', 401, 'Vui lòng đăng nhập lại'];
    return NextResponse.json({ success: false, error: { code, message } }, { status: status as number });
};

/** Checks permission and resolves the acting staff id from the session (never from the body). */
export async function authorizePromotion(permissionId: string): Promise<{ staffId: string | null } | Response> {
    try {
        await requirePermission(permissionId);
    } catch (e) {
        return authFailure(e);
    }
    try {
        const user = await requireBusinessUser();
        return { staffId: user?.techCode || user?.businessUserId || null };
    } catch (e) {
        if ((e as Error)?.message === 'ACCOUNT_LOCKED' || (e as Error)?.message === 'Unauthorized') return authFailure(e);
        return { staffId: null };   // AUTH_ENFORCE_API off and no mapped user: same fallback as other routes
    }
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
