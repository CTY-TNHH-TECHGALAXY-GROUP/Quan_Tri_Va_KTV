import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { z } from 'zod';

const ReviewReceptionSchema = z.object({
  bookingId: z.string().uuid(),
  techCode: z.string().min(1),
  rating: z.number().min(1).max(5),
  note: z.string().optional(),
  images: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = ReviewReceptionSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
    }

    const { bookingId, techCode, rating, note, images } = parseResult.data;
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'DB Init Error' }, { status: 500 });

    // Kiểm tra xem KTV này đã đánh giá đơn này chưa
    const { data: existing } = await supabase
      .from('KTVReviewReception')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('ktv_id', techCode)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: false, error: 'Bạn đã đánh giá Lễ tân cho đơn này rồi.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('KTVReviewReception')
      .insert({
        ktv_id: techCode,
        booking_id: bookingId,
        rating,
        note: note || null,
        images: images || [],
      });

    if (error) {
      console.error('❌ [Review Reception]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('❌ [Review Reception]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
