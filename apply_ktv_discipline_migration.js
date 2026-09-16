require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const client = new Client({
        connectionString: process.env.DIRECT_URL // Use DIRECT_URL instead of DATABASE_URL
    });

    try {
        await client.connect();
        console.log('Đã kết nối Database (DIRECT_URL)...');
        
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260806133900_add_ktv_discipline.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        await client.query(sql);
        console.log('✅ Chạy migration Điểm Kỷ Luật thành công.');
        
    } catch (err) {
        console.error('Lỗi Migration:', err);
    } finally {
        await client.end();
    }
}
runMigration();
