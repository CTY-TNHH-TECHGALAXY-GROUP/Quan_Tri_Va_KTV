const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'C:/Users/ADMIN/OneDrive/Desktop/Ngan Ha/Quan_Tri_Va_KTV/.env.local';
const env = fs.readFileSync(envPath, 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function run() {
  const { data: users, error: err1 } = await supabase.from('Users').select('*');
  if (err1) return console.log(err1);
  
  const { data: staff, error: err2 } = await supabase.from('Staff').select('*');
  if (err2) return console.log(err2);

  const staffIds = new Set(staff.map(s => s.id));
  const missingUsers = users.filter(u => !staffIds.has(u.id));

  for (const user of missingUsers) {
    console.log('Inserting into Staff:', user.id, user.fullName);
    const { error } = await supabase.from('Staff').insert({
      id: user.id,
      full_name: user.fullName || 'No Name',
      position: user.role || 'GUEST',
      status: 'working'
    });
    if (error) console.log('Error inserting:', error.message);
  }
  console.log('Done!');
}

run();
