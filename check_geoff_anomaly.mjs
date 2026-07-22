import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

envFile.split('\n').forEach(line => {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) SUPABASE_URL = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) SUPABASE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkWhySplitFailed() {
  const { data: customers } = await supabase.from('Customers').select('id, fullName, phone, email, lastVisited');
  const customerMap = {};
  customers.forEach(c => customerMap[c.id] = c);

  const targetId = 'CUS-1780397652646-405'; // Geoff
  console.log("Base customer in map:", customerMap[targetId]);
  
  if (customerMap[targetId] && customerMap[targetId].phone.toUpperCase().includes('GUEST')) {
      console.log("IT INCLUDES GUEST!");
  } else {
      console.log("IT DOES NOT INCLUDE GUEST!");
  }
}

checkWhySplitFailed().catch(console.error);
