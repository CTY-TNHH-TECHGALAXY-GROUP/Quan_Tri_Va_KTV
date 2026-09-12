import { createClient } from '@supabase/supabase-js';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const { Client } = pkg;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const directUrl = process.env.DIRECT_URL;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("1. Áp dụng migration trực tiếp bằng Client pg...");
    const client = new Client({ connectionString: directUrl });
    try {
        await client.connect();
        const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260830_add_dispatch_booking_guard.sql'), 'utf-8');
        await client.query(sql);
        console.log("✅ Đã áp dụng migration thành công.");
    } catch (e) {
        console.error("❌ Lỗi áp dụng migration:", e.message);
    } finally {
        await client.end();
    }

    console.log("\n2. Gọi RPC dispatch_confirm_booking với mã giả...");
    const { data: rpcData, error: rpcError } = await supabase.rpc('dispatch_confirm_booking', {
        p_booking_id: '123-FAKE-ID-A',
        p_date: '2026-08-30',
        p_status: 'PREPARING',
        p_technician_code: 'NH011',
        p_bed_id: 'BED-1',
        p_room_name: 'P1',
        p_notes: '',
        p_staff_assignments: [],
        p_item_updates: []
    });
    
    if (rpcError) {
        console.log("Kết quả RPC Error:", rpcError);
    } else {
        console.log("Kết quả RPC Data:", rpcData);
    }

    console.log("\n3. Xóa 3 dòng TurnLedger mồ côi...");
    const orphanIds = [
        "4f4add30-69d2-431d-a9fc-67e77d552aa3",
        "015a8958-3ba4-44c9-b7d8-2a9ae94ec2bc",
        "f31dcf2c-9bde-4c13-b81e-5d07ff26340e"
    ];
    
    const { data: delData, error: delError } = await supabase
        .from('TurnLedger')
        .delete()
        .in('id', orphanIds);
        
    if (delError) {
        console.error("❌ Lỗi xóa mồ côi:", delError);
    } else {
        console.log("✅ Đã xóa 3 dòng mồ côi thành công.");
    }
}

run();
