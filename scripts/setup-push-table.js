const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://adzfohfdindovfcpaizb.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8');

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
