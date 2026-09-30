require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        console.log('✅ Đã kết nối Database...');
        
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260622000000_create_support_tasks.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        await client.query(sql);
        console.log('✅ Chạy migration Support Tasks thành công!');
        
    } catch (err) {
        console.error('❌ Lỗi Migration:', err);
    } finally {
        await client.end();
    }
}
runMigration();
