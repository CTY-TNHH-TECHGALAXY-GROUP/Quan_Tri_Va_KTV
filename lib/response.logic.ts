import { NextResponse } from 'next/server';

/**
 * 📡 SHARED API RESPONSE LOGIC
 * Chuẩn hoá format trả về của tất cả các API route.
 */

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
    [key: string]: any; // Phục vụ một số API trả về pagination hoặc metadata
}

/**
 * Trả về HTTP 200 OK cùng dữ liệu chuẩn.
 */
export const apiSuccess = <T>(data: T, status = 200) => {
    return NextResponse.json({ success: true, ...data }, { status });
};

/**
 * Trả về HTTP Error (mặc định 500) kèm message.
 */
export const apiError = (message: string, status = 500, code?: string) => {
    return NextResponse.json({ success: false, error: message, code }, { status });
};

/**
 * Wrapper HOC cho API Route để tự động try/catch và log lỗi chuẩn mực.
 * Sử dụng: export const GET = withErrorHandler(async (req) => { ... });
 */
export const withErrorHandler = (handler: (req: Request, ctx: any) => Promise<NextResponse>) => {
    return async (req: Request, ctx: any) => {
        try {
            return await handler(req, ctx);
        } catch (error: any) {
            console.error(`❌ [API Error] ${req.method} ${req.url}:`, error.message, error.code || '');
            
            // Xử lý các lỗi cụ thể (ví dụ JWT expired, Unauthorized...)
            if (error.code === 'PGRST301') {
                return apiError('Lỗi database row-level security', 403, error.code);
            }
            
            return apiError(error.message || 'Lỗi hệ thống không xác định', error.status || 500, error.code);
        }
    };
};
