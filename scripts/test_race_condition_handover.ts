import assert from 'assert';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// NOTE: The Next.js server must be running on localhost:3000 (npm run dev) for these tests to pass.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);
const API_URL = process.env.TEST_API_URL || 'http://localhost:3000/api/ktv/booking';

async function sendPatchRequest(body: any) {
    const res = await fetch(API_URL, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function runTest() {
    console.log("Running race condition assertions via API...");
    const testBookingId = 'TEST-RACE-001';

    try {
        await supabase.from('BookingItems').delete().eq('bookingId', testBookingId);
        await supabase.from('Bookings').delete().eq('id', testBookingId);

        await supabase.from('Services').delete().eq('id', 'sv1');
        const { error: sErr } = await supabase.from('Services').insert({
            id: 'sv1',
            code: 'SV1',
            nameVN: 'Dịch vụ Test',
            duration: 60
        });
        if (sErr) throw sErr;

        console.log("---- Scenario 1: Reception sets DONE first ----");
        const { error: bErr1 } = await supabase.from('Bookings').insert({
            id: testBookingId,
            billCode: 'BILL-RACE-001',
            status: 'DONE',
            rating: null,
            customerName: 'Test Race',
            updatedAt: new Date().toISOString()
        });
        if (bErr1) throw bErr1;

        const { data: insertedItem, error: insertError } = await supabase.from('BookingItems').insert({
            id: testBookingId + '-item1',
            bookingId: testBookingId,
            serviceId: 'sv1',
            status: 'DONE',
            technicianCodes: ['T001'],
            price: 0,
            quantity: 1,
            segments: JSON.stringify([{
                ktvId: 'T001',
                duration: 60,
                actualStartTime: new Date().toISOString()
            }])
        }).select().single();
        if (insertError) throw insertError;

        await sendPatchRequest({
            bookingId: testBookingId,
            techCode: 'T001',
            status: 'FEEDBACK',
            action: 'RELEASE_KTV',
            photosBase64: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==']
        });

        const { data: checkItem1 } = await supabase.from('BookingItems').select('status, handover_status, handover_images').eq('id', insertedItem.id).single();
        
        assert.strictEqual(checkItem1!.status, 'DONE', 'Item status must NOT rollback from DONE');
        assert.strictEqual(checkItem1!.handover_status, 'PENDING', 'Handover status should be PENDING');
        assert.ok(checkItem1!.handover_images && Object.keys(checkItem1!.handover_images).length > 0, 'Handover images must be populated');
        console.log("Scenario 1 PASSED");

        console.log("---- Scenario 2: Guest rates before KTV handover ----");
        await supabase.from('BookingItems').delete().eq('bookingId', testBookingId);
        await supabase.from('Bookings').update({ status: 'IN_PROGRESS', rating: 5 }).eq('id', testBookingId);

        const { data: insertedItem2 } = await supabase.from('BookingItems').insert({
            id: testBookingId + '-item2',
            bookingId: testBookingId,
            serviceId: 'sv1',
            status: 'IN_PROGRESS',
            technicianCodes: ['T001'],
            price: 0,
            quantity: 1,
            segments: JSON.stringify([{
                ktvId: 'T001',
                duration: 60,
                actualStartTime: new Date().toISOString()
            }])
        }).select().single();

        await sendPatchRequest({
            bookingId: testBookingId,
            techCode: 'T001',
            status: 'CLEANING',
            action: 'FINISH_SERVICE'
        });

        const { data: checkItem2 } = await supabase.from('BookingItems').select('status').eq('id', insertedItem2.id).single();
        
        assert.strictEqual(checkItem2!.status, 'CLEANING', 'Must not jump to DONE without handover step');
        console.log("Scenario 2 PASSED (Item status: " + checkItem2!.status + ")");

        console.log("---- Scenario 3: 2 KTVs finishing simultaneously ----");
        await supabase.from('BookingItems').delete().eq('bookingId', testBookingId);
        await supabase.from('Bookings').update({ status: 'IN_PROGRESS', rating: null }).eq('id', testBookingId);

        const { data: insertedItem3 } = await supabase.from('BookingItems').insert({
            id: testBookingId + '-item3',
            bookingId: testBookingId,
            serviceId: 'sv1',
            status: 'IN_PROGRESS',
            technicianCodes: ['T001', 'T002'],
            price: 0,
            quantity: 1,
            segments: JSON.stringify([{
                ktvId: 'T001',
                duration: 60,
                actualStartTime: new Date().toISOString()
            }, {
                ktvId: 'T002',
                duration: 60,
                actualStartTime: new Date().toISOString()
            }])
        }).select().single();

        await sendPatchRequest({
            bookingId: testBookingId,
            techCode: 'T001',
            status: 'CLEANING',
            action: 'FINISH_SERVICE'
        });

        const { data: checkItem3 } = await supabase.from('BookingItems').select('status').eq('id', insertedItem3.id).single();
        const { data: checkBooking3 } = await supabase.from('Bookings').select('status').eq('id', testBookingId).single();
        
        // Because T002 hasn't finished, item status remains IN_PROGRESS
        assert.strictEqual(checkItem3!.status, 'IN_PROGRESS', 'Must not jump to CLEANING while T002 is still working');
        // Check Booking status to ensure it hasn't jumped to DONE/FEEDBACK
        assert.strictEqual(checkBooking3!.status, 'IN_PROGRESS', 'Booking must not jump to DONE while item is IN_PROGRESS');
        
        console.log("Scenario 3 PASSED (Item status: " + checkItem3!.status + ", Booking status: " + checkBooking3!.status + ")");

        console.log("All race condition assertions passed.");
    } catch (e) {
        console.error("Test failed:", e);
        process.exit(1);
    } finally {
        await supabase.from('BookingItems').delete().eq('bookingId', testBookingId);
        await supabase.from('Bookings').delete().eq('id', testBookingId);
        await supabase.from('Services').delete().eq('id', 'sv1');
    }
}

runTest();
