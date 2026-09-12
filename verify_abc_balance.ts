import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// We need to query local DB directly because NextJS dev server is probably not running
// Actually, I can just write a script that imports the routes directly, or query DB to see if `work_type_snapshot` is fixed.
// But the prompt asks to run a script testing the endpoints for A/B/C and outputting their balances before and after.

// I'll start the Next.js dev server in the background and hit it? No, wait! I can just import the route handlers directly!
import { GET as getBalance } from './app/api/ktv/wallet/balance/route';
import { GET as getBonusBalance } from './app/api/ktv/wallet/bonus/balance/route';
import { GET as getTimeline } from './app/api/ktv/wallet/timeline/route';
import { GET as getBonusTimeline } from './app/api/ktv/wallet/bonus/timeline/route';

async function runRoute(routeFn: any, techCode: string) {
    const req = new Request(`http://localhost/api/test?techCode=${techCode}`);
    const res = await routeFn(req);
    return await res.json();
}

async function run() {
    const targetKTVs = ['NH025', 'NH027', 'NH021'];

    for (const ktv of targetKTVs) {
        console.log(`\n=== KTV: ${ktv} ===`);
        
        try {
            const balance = await runRoute(getBalance, ktv);
            console.log(`[Balance] Available: ${balance.available_balance}`);
        } catch(e: any) { console.error('Balance err:', e.message); }

        try {
            const bonus = await runRoute(getBonusBalance, ktv);
            console.log(`[Bonus Balance] Available: ${bonus.available_balance}`);
        } catch(e: any) { console.error('Bonus Balance err:', e.message); }

        try {
            const timeline = await runRoute(getTimeline, ktv);
            let timelineItems = 0;
            if (timeline.timeline) timelineItems = timeline.timeline.length;
            else timelineItems = timeline.length || 0; // sometimes it returns array directly
            console.log(`[Timeline] Items count: ${timelineItems}`);
        } catch(e: any) { console.error('Timeline err:', e.message); }

        try {
            const bonusTimeline = await runRoute(getBonusTimeline, ktv);
            let timelineItems = 0;
            if (bonusTimeline.timeline) timelineItems = bonusTimeline.timeline.length;
            else timelineItems = bonusTimeline.length || 0;
            console.log(`[Bonus Timeline] Items count: ${timelineItems}`);
        } catch(e: any) { console.error('Bonus Timeline err:', e.message); }
    }
}

run();
