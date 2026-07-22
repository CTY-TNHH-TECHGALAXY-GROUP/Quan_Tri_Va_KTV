'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function getServices() {
    try {
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
            showFocus: payload.showFocus
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

