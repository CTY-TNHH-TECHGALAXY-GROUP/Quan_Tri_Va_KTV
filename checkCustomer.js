const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://adzfohfdindovfcpaizb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2Nzk4MDAsImV4cCI6MjA4NzI1NTgwMH0.C7-HhcJDfbh41JTcoc-mjguSiGiTvN3SjDl-OecDKIk'
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
