const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.adzfohfdindovfcpaizb:nganhaspa2026@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
});

(async () => {
  try {
    await client.connect();
    // Add room_id column
    await client.query(`
      ALTER TABLE "EmployeeRoutines" 
      ADD COLUMN IF NOT EXISTS room_id text REFERENCES "Rooms"(id) ON DELETE CASCADE;
    `);
    
    const res = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = '"EmployeeRoutines"'::regclass AND contype = 'u';
    `);
    for (let row of res.rows) {
      if (row.conname) {
        await client.query(`ALTER TABLE "EmployeeRoutines" DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
    }
    
    await client.query(`
      DROP INDEX IF EXISTS unique_emp_routine;
    `);
    await client.query(`
      CREATE UNIQUE INDEX unique_emp_routine ON "EmployeeRoutines" (employee_id, template_id, COALESCE(room_id, ''));
    `);

    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
})();
