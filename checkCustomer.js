require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
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
