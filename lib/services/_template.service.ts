import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SupabaseClient } from '@supabase/supabase-js';

export interface ExecuteParams {
    id: string;
    // Add other params here
}

export interface ExecuteResult {
    // Add return data shape here
    status: string;
}

/**
 * Mẫu Service Layer cho backend (S.O.L.I.D)
 * 
 * Cách dùng:
 * 1. API Route (route.ts) chỉ nhận request, gọi service này.
 * 2. Mọi logic tính toán, DB query nằm trong hàm execute.
 * 3. Nếu logic phức tạp, chia thành các hàm private nhỏ trong class.
 */
export class FeatureNameService {
    private supabase: SupabaseClient;

    constructor() {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            throw new Error('Supabase admin not initialized');
        }
        this.supabase = supabase;
    }

    /**
     * Hàm chạy chính (entry point).
     */
    async execute(params: ExecuteParams): Promise<ExecuteResult> {
        try {
            // 1. Validate Input
            this.validate(params);

            // 2. Query DB
            const data = await this.fetchData(params.id);

            // 3. Xử lý Logic Nghiệp Vụ
            const processedData = this.processData(data);

            // 4. Update DB (nếu có)
            await this.updateData(processedData);

            // 5. Trả về kết quả
            return {
                status: 'SUCCESS'
            };
        } catch (error: any) {
            console.error('❌ [FeatureNameService.execute] Error:', error);
            throw error; // Ném lỗi ra ngoài cho route.ts catch (hoặc withErrorHandler)
        }
    }

    private validate(params: ExecuteParams) {
        if (!params.id) throw new Error('Thiếu ID');
    }

    private async fetchData(id: string) {
        const { data, error } = await this.supabase
            .from('YourTable')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error) throw error;
        return data;
    }

    private processData(data: any) {
        return { ...data, processedAt: new Date().toISOString() };
    }

    private async updateData(data: any) {
        const { error } = await this.supabase
            .from('YourTable')
            .update({ status: 'DONE' })
            .eq('id', data.id);
            
        if (error) throw error;
    }
}
