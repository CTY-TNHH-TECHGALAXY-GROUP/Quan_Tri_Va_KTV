import { NextResponse } from 'next/server';
import { authErrorResponse, getSessionAccess } from '@/lib/auth-server';
import { TaskActionError } from '@/lib/services/officeTaskActions.service';

/** Who is acting, for TaskEvents / reviewed_by. Null when there is no session (AUTH_ENFORCE_API off). */
export const sessionActor = async () => {
  const s = await getSessionAccess();
  if (s.status !== 'OK') return { actorId: null as string | null, userId: null as string | null };
  return { actorId: s.techCode || s.businessUserId || null, userId: s.businessUserId || null };
};

/** Uniform error → response mapping for the support task routes. */
export const taskErrorResponse = (error: any, where: string) => {
  const authRes = authErrorResponse(error);
  if (authRes) return authRes;
  if (error instanceof TaskActionError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  console.error(`API Error ${where}:`, error?.message || error);
  return NextResponse.json({ success: false, error: error?.message || 'Internal Server Error' }, { status: 500 });
};
