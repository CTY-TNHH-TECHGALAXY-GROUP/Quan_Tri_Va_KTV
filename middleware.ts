import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Route API không cần session: tự xác thực bằng secret riêng, hoặc được quyết
// định để mở. Mọi route /api/* khác bắt buộc có JWT khi AUTH_ENFORCE_API=1.
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/cron',                          // requireCronAuth (CRON_SECRET)
  '/api/notifications/trigger-webhook', // x-webhook-secret
  '/api/notifications/push',            // x-webhook-secret
  '/api/ktv/booking',                   // điều phối — quyết định để mở (30/09/2026)
  '/api/customers/identify',            // không có caller trong repo — chờ quyết định
  '/api/resend-email',                  // không có caller trong repo — chờ quyết định
]

// Bật bằng env AUTH_ENFORCE_API=1. Tắt (mặc định) = hành vi cũ: chỉ ghi log.
// Lùi khi có sự cố: xoá biến env rồi redeploy, không cần revert code.
const AUTH_ENFORCE = process.env.AUTH_ENFORCE_API === '1'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          supabaseResponse.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          supabaseResponse.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with cross-site tracking.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Bảo vệ /api/*: không có user → 401 khi đã bật cờ, còn lại chỉ ghi log để
  // đếm xem còn ai gọi API mà chưa có JWT trước khi bật.
  const path = request.nextUrl.pathname
  const isProtectedApi = path.startsWith('/api/') && !PUBLIC_API_PREFIXES.some(p => path.startsWith(p))
  if (isProtectedApi && !user) {
    if (AUTH_ENFORCE) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    console.warn(`[Middleware] Unauthorized API call to ${path} (AUTH_ENFORCE_API off - allowed)`);
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
