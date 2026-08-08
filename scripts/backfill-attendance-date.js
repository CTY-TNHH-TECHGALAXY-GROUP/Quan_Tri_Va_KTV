require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching records with null date...');
  const { data, error } = await supabase
    .from('KTVAttendance')
    .select('id, "checkedAt"')
    .is('date', null);

  if (error) {
    console.error('Error fetching data:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No records found that need backfilling.');
    return;
  }

  console.log(`Found ${data.length} records. Processing...`);

  // Try to get cutoff from SystemConfigs (default to 6)
  let cutoffHours = 6;
  const { data: cutoffConfig } = await supabase
      .from('SystemConfigs')
      .select('value')
      .eq('key', 'spa_day_cutoff_hours')
      .maybeSingle();
      
  if (cutoffConfig && cutoffConfig.value != null) {
      cutoffHours = Number(cutoffConfig.value);
  }

  let updatedCount = 0;
  for (const record of data) {
    if (!record.checkedAt) continue;

    // checkedAt is in UTC (timestamp or timestamptz)
    // Supabase JS often returns it as string, so we construct Date
    const checkedAtDate = new Date(record.checkedAt);
    
    // Convert to VN time (+7 hours)
    const vnTime = new Date(checkedAtDate.getTime() + 7 * 60 * 60 * 1000);
    
    // Apply cutoff to get Business Date
    const businessNow = new Date(vnTime.getTime() - cutoffHours * 60 * 60 * 1000);
    const dateStr = businessNow.toISOString().split('T')[0];

    const { error: updateError } = await supabase
      .from('KTVAttendance')
      .update({ date: dateStr })
      .eq('id', record.id);

    if (updateError) {
      console.error(`Failed to update record ${record.id}:`, updateError);
    } else {
      updatedCount++;
      if (updatedCount % 50 === 0) {
          console.log(`...Updated ${updatedCount}/${data.length} records...`);
      }
    }
  }

  console.log(`Successfully updated ${updatedCount} records!`);
}

run();
