export class ApiError extends Error {
  public status: number;
  public code?: string;
  public data?: any;

  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface ApiOptions extends RequestInit {
  retries?: number;
  timeout?: number;
  parseJson?: boolean;
}

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 0;

/**
 * 🚀 Centralized API Client
 * - Tự động handle JSON parsing
 * - Tự động check res.ok và throw lỗi chuẩn
 * - Hỗ trợ timeout & retry
 */
class ApiClient {
  private async fetchWithTimeout(url: string, options: ApiOptions = {}): Promise<Response> {
    const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      // ⚠️ KHÔNG để trình duyệt cache. Mọi đường trong `/api` ở đây đều là dữ
      // liệu sống — điểm, ví, tua, cờ tính năng. Trước đây không đặt gì cả, mà
      // các route này cũng không gắn Cache-Control, nên Safari trên iOS giữ lại
      // bản JSON cũ: admin tắt một tính năng, KTV mở app vẫn thấy y như cũ, F5
      // cũng vậy, phải xoá dữ liệu web mới hết.
      //
      // Vẫn cho ghi đè qua `options` nếu chỗ nào thật sự muốn cache.
      cache: 'no-store',
      ...fetchOptions,
      signal: controller.signal
    });
    
    clearTimeout(id);
    return response;
  }

  private async request<T>(url: string, options: ApiOptions = {}): Promise<T> {
    const { retries = DEFAULT_RETRIES, parseJson = true, ...fetchOptions } = options;
    let lastError: Error | null = null;

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await this.fetchWithTimeout(url, fetchOptions);

        if (!response.ok) {
          let errorData;
          try {
            errorData = await response.json();
          } catch {
            errorData = { error: response.statusText };
          }
          if (errorData.error === 'ACCOUNT_LOCKED') {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('account_locked', { detail: { isLocked: true } }));
            }
          }

          // 🔑 JWT Supabase hết hạn → mọi API trả 401. Báo cho auth-context ép đăng nhập lại,
          // thay vì để từng màn hình kẹt ở trạng thái "Đang tải..." mà không ai biết vì sao.
          if (response.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('session_expired'));
          }

          throw new ApiError(
            errorData.error || errorData.message || 'Lỗi kết nối API',
            response.status,
            errorData.code,
            errorData
          );
        }

        if (parseJson) {
          // Xử lý 204 No Content
          if (response.status === 204) return null as T;
          return (await response.json()) as T;
        }

        return response as unknown as T;
      } catch (error: any) {
        lastError = error;
        // Chỉ retry với lỗi network (fetch failed) hoặc 5xx, không retry lỗi 4xx
        if (error instanceof ApiError && error.status < 500) {
          throw error;
        }
        if (error.name === 'AbortError') {
          throw new Error('Kết nối bị quá hạn (Timeout). Vui lòng thử lại.');
        }

        // NEW: retry network fail
        const isNetworkFail = error instanceof TypeError && /failed to fetch|network/i.test(error.message);
        if (isNetworkFail && i < retries) {
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
            continue;
        }
        
        // Delay trước khi retry (exponential backoff cơ bản)
        if (i < retries) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }

    throw lastError || new Error('Lỗi không xác định');
  }

  get<T>(url: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  post<T>(url: string, body?: any, options?: ApiOptions): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(url: string, body?: any, options?: ApiOptions): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  
  put<T>(url: string, body?: any, options?: ApiOptions): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(url: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
