require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://adzfohfdindovfcpaizb.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

async function run() {
  const { data: customer, error: errorCustomer } = await supabase
    .from('Customers')
    .select('*')
    .eq('id', 'CUS-1783760257591-612')
    .single();

  console.log('Customer:', customer);
  if (errorCustomer) console.error('Error Customer:', errorCustomer);
}

run();
