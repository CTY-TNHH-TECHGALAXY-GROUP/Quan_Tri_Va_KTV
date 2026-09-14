const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...rest] = line.split('=');
  if(key && rest.length > 0) acc[key.trim()] = rest.join('=').trim().replace(/['"]+/g, '');
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
supabase.from('Rooms').select('id, name, type').then(res => console.log(JSON.stringify(res.data, null, 2)));
