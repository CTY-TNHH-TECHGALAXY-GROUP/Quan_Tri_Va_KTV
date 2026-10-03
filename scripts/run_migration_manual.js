const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DIRECT_URL
  });
  
  try {
    await client.connect();
    console.log('Connected to DB');
    const sql = fs.readFileSync('supabase/migrations/20260901000000_add_type_d_support.sql', 'utf8');
    await client.query(sql);
    console.log('Migration executed successfully');
    
    // Add to supabase_migrations if table exists, just in case
    try {
        await client.query(`INSERT INTO supabase_migrations.schema_migrations (version, statements) VALUES ('20260901000000', ARRAY[$tag$${sql}$tag$]) ON CONFLICT DO NOTHING;`);
        console.log('Inserted into schema_migrations');
    } catch (err) {
        console.log('Could not insert into schema_migrations, ignoring', err.message);
    }
  } catch (error) {
    console.error('Error executing migration:', error);
  } finally {
    await client.end();
  }
}

runMigration();
