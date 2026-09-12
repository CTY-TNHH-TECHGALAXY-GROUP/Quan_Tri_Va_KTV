/**
 * Chạy MỘT file migration SQL lên DB qua DIRECT_URL trong .env.local rồi in
 * lại các cột vừa đụng. Dùng khi máy không có psql / supabase CLI. `-T` vì repo
 * không cài @types/pg.
 *
 *   npx ts-node -T -O "{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}" scripts/apply_migration_file.ts supabase/migrations/<file>.sql
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const file = process.argv[2];
if (!file) { console.error('Thiếu đường dẫn file .sql'); process.exit(1); }
if (!process.env.DIRECT_URL) { console.error('Thiếu DIRECT_URL trong .env.local'); process.exit(1); }

(async () => {
    const client = new Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    const sql = fs.readFileSync(file, 'utf8');
    await client.query(sql);
    console.log(`✅ Đã chạy ${file}`);
    const cols = Array.from(sql.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)).map(m => m[1]);
    if (cols.length) {
        const r = await client.query(
            `select table_name, column_name, data_type, column_default, is_nullable
             from information_schema.columns where column_name = any($1)`, [cols]);
        console.table(r.rows);
    }
    await client.end();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
