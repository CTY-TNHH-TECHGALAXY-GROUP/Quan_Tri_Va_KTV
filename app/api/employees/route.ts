import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data: staff, error } = await supabase
            .from('Staff')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch user login data to display username and password
        const { data: users, error: usersError } = await supabase
            .from('Users')
            .select('id, username, password');

        if (usersError) {
            console.warn("Could not fetch Users data", usersError);
        }

        const staffWithAuth = staff.map(s => {
            const authInfo = users?.find(u => u.id === s.id);
            return {
                ...s,
                username: authInfo?.username || s.id,
                password: authInfo?.password || '---'
            };
        });

        return NextResponse.json({ success: true, data: staffWithAuth });
    } catch (error: any) {
        console.error('API Error (Employees):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
