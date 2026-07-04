import { syncTurnsForDate } from './lib/turn-sync';

// Must load env before running
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) process.env.SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1].trim();
});

async function run() {
    console.log('Running syncTurnsForDate...');
    await syncTurnsForDate('2026-07-04');
    console.log('Done!');
}
run();
