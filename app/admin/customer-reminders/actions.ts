'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export interface ReminderInput {
    contentVN: string;
    contentEN: string;
    contentCN: string;
    contentJP: string;
    contentKR: string;
    is_active: boolean;
    order_index: number;
}

export async function getReminders() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data, error } = await supabase
            .from('Reminders_Customer')
            .select('*')
            .order('order_index', { ascending: true })
            .order('created_at', { ascending: false });

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] getReminders error:', error);
        return { success: false, error: error.message };
    }
}

export async function createReminder(payload: ReminderInput) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data, error } = await supabase
            .from('Reminders_Customer')
            .insert(payload)
            .select()
            .single();

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] createReminder error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateReminder(id: string, payload: Partial<ReminderInput>) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data, error } = await supabase
            .from('Reminders_Customer')
            .update(payload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('❌ [Server] updateReminder error:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteReminder(id: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { error } = await supabase
            .from('Reminders_Customer')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] deleteReminder error:', error);
        return { success: false, error: error.message };
    }
}
