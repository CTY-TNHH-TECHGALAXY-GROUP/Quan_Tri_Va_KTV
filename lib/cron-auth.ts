import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export function requireCronAuth(request: Request): NextResponse | null {
    const secret = process.env.CRON_SECRET;
    const provided = request.headers.get('authorization');
    const expected = secret ? `Bearer ${secret}` : '';
    const providedBytes = Buffer.from(provided || '');
    const expectedBytes = Buffer.from(expected);
    const valid = Boolean(secret && provided && providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes));

    return valid ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
