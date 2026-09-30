'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole, requireBusinessUser } from '@/lib/auth-server';

export async function getServices() {
    try {
        if (!(await requireBusinessUser()) && process.env.AUTH_ENFORCE_API === '1') throw new Error('Unauthorized');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data, error } = await supabase
            .from('Services')
            .select('*')
            .order('category', { ascending: true })
            .order('nameVN', { ascending: true });

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] getServices error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function updateService(serviceId: string, payload: Partial<import('@/lib/types').Service>) {
    try {
        await requireRole(['ADMIN', 'DEV', 'MANAGER']);
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Drop undefined properties
        const cleanPayload = Object.fromEntries(
            Object.entries(payload).filter(([_, v]) => v !== undefined)
        );

        const { data, error } = await supabase
            .from('Services')
            .update(cleanPayload)
            .eq('id', serviceId)
            .select()
            .single();

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] updateService error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function updateServiceBulkSync(originalNameVN: string, payload: Partial<import('@/lib/types').Service>) {
    try {
        await requireRole(['ADMIN', 'DEV', 'MANAGER']);
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Extract ONLY the fields that should be synced
        const syncPayload = {
            nameVN: payload.nameVN,
            nameEN: payload.nameEN,
            nameCN: payload.nameCN,
            nameJP: payload.nameJP,
            nameKR: payload.nameKR,
            description: payload.description,
            service_description: payload.service_description,
            procedure: payload.procedure,
            tags: payload.tags,
            focusConfig: payload.focusConfig,
            imageUrl: payload.imageUrl,
            category: payload.category,
            showCustomForYou: payload.showCustomForYou,
            showNotes: payload.showNotes,
            showGender: payload.showGender,
            showStrength: payload.showStrength,
            strengthConfig: payload.strengthConfig,
            showFocus: payload.showFocus,
            min_ktv_required: payload.min_ktv_required,
            service_group: payload.service_group
        };

        const cleanPayload = Object.fromEntries(
            Object.entries(syncPayload).filter(([_, v]) => v !== undefined)
        );

        if (Object.keys(cleanPayload).length === 0) {
            return { success: true };
        }

        const { error } = await supabase
            .from('Services')
            .update(cleanPayload)
            .eq('nameVN', originalNameVN);

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] updateServiceBulkSync error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function createService(payload: Partial<import('@/lib/types').Service>) {
    try {
        await requireRole(['ADMIN', 'DEV', 'MANAGER']);
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const cleanPayload: any = Object.fromEntries(
            Object.entries(payload).filter(([_, v]) => v !== undefined)
        );

        if (!cleanPayload.id) {
            cleanPayload.id = `SVC_${Date.now()}`;
        }
        if (!cleanPayload.name) {
            cleanPayload.name = cleanPayload.nameVN || cleanPayload.nameEN || 'Dịch vụ mới';
        }
        if (cleanPayload.price === undefined) {
            cleanPayload.price = cleanPayload.priceVND || 0;
        }

        const { data, error } = await supabase
            .from('Services')
            .insert(cleanPayload)
            .select()
            .single();

        if (error) throw error;
        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] createService error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}
