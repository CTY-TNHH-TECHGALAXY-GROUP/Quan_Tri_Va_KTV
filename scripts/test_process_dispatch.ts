import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { processDispatch } from '../app/reception/dispatch/actions';

async function run() {
    console.log('Testing processDispatch...');
    try {
        const result = await processDispatch('mock-booking-id', {
            status: 'IN_PROGRESS',
            technicianCode: 'HIEUU',
            staffAssignments: [],
            itemUpdates: [],
            date: '2026-07-22'
        });
        console.log('Result:', result);
    } catch (e) {
        console.error('Error caught:', e);
    }
}
run();
