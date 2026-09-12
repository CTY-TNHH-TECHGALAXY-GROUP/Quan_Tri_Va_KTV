const { Client } = require('pg');

async function runMigration() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        console.log('Đã kết nối Database...');
        
        // 1. Thêm cột
        await client.query('ALTER TABLE "WalletAdjustments" ADD COLUMN IF NOT EXISTS wallet_type VARCHAR DEFAULT \'TUA\';');
        await client.query('ALTER TABLE "KTVWithdrawals" ADD COLUMN IF NOT EXISTS wallet_type VARCHAR DEFAULT \'TUA\';');
        console.log('✅ Đã thêm cột wallet_type thành công.');

        // 2. Đóng dấu TUA
        await client.query('UPDATE "WalletAdjustments" SET wallet_type = \'TUA\' WHERE wallet_type IS NULL;');
        await client.query('UPDATE "KTVWithdrawals" SET wallet_type = \'TUA\' WHERE wallet_type IS NULL;');
        console.log('✅ Đã đóng dấu TUA cho toàn bộ dữ liệu cũ.');
        
    } catch (err) {
        console.error('Lỗi Migration:', err);
    } finally {
        await client.end();
    }
}
runMigration();
