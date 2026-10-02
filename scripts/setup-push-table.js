require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function createPushTable() {
    console.log('🚀 Creating StaffPushSubscriptions table...');
    
    // In a real scenario with SQL access, we would use:
    /*
    CREATE TABLE IF NOT EXISTS public."StaffPushSubscriptions" (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        staff_id uuid REFERENCES public."Staff"(id) ON DELETE CASCADE,
        subscription jsonb NOT NULL,
        user_agent text,
        created_at timestamp with time zone DEFAULT now(),
        updated_at timestamp with time zone DEFAULT now()
    );
    */

    console.log('⚠️ Please execute the SQL in Supabase Dashboard SQL Editor:');
    console.log(`
CREATE TABLE IF NOT EXISTS public."StaffPushSubscriptions" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid REFERENCES public."Staff"(id) ON DELETE CASCADE,
    subscription jsonb NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_staff_push_staff_id ON public."StaffPushSubscriptions"(staff_id);
    `);
}

createPushTable();
