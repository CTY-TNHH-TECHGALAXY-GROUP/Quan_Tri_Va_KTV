import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    // Generate random file name
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_review_${Math.random().toString(36).substring(7)}.${fileExt}`;

    // Upload to bucket using Admin Service Role key (bypasses RLS)
    const { error: uploadError, data } = await supabase.storage
      .from('task-photos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('API Error uploading review photo:', uploadError);
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: data.path });
  } catch (error: any) {
    console.error('API Error /api/support/tasks/rework-photo POST:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
