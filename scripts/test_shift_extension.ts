import assert from 'node:assert/strict';
import { addMinutesToTime } from '../lib/shift.constants';
import { AttendanceSchema } from '../lib/schemas/ktv.schema';

console.log('🧪 Running Shift Extension & Schedule Unit Tests...\n');

// ── Test 1: addMinutesToTime ──
console.log('Test Suite 1: addMinutesToTime calculations');
assert.equal(addMinutesToTime('17:00', 60), '18:00', '17:00 + 60 mins should be 18:00');
assert.equal(addMinutesToTime('19:00', 90), '20:30', '19:00 + 90 mins should be 20:30');
assert.equal(addMinutesToTime('23:30', 60), '00:30', '23:30 + 60 mins should cross midnight to 00:30');
assert.equal(addMinutesToTime('00:00', 120), '02:00', '00:00 + 120 mins should be 02:00');
assert.equal(addMinutesToTime('22:45', 75), '00:00', '22:45 + 75 mins should be 00:00');
assert.equal(addMinutesToTime('23:15', 120), '01:15', '23:15 + 120 mins should be 01:15');
console.log('✅ addMinutesToTime passed all cases.\n');

// ── Test 2: Business date cutoff time comparisons ──
console.log('Test Suite 2: Working hours validation (with midnight crossing)');
function phutTrongNgayLamViec(hhmm: string, cutoffHour: number = 6): number {
    const [h, m] = hhmm.split(':').map(Number);
    return (h < cutoffHour ? h + 24 : h) * 60 + m;
}

// Normal shift
assert.ok(
    phutTrongNgayLamViec('22:00') > phutTrongNgayLamViec('10:00'),
    '10:00 to 22:00 should be valid'
);

// Overnight shift past midnight before cutoff (e.g. 17:00 to 01:00)
assert.ok(
    phutTrongNgayLamViec('01:00') > phutTrongNgayLamViec('17:00'),
    '17:00 to 01:00 should be valid overnight shift'
);

assert.ok(
    phutTrongNgayLamViec('02:30') > phutTrongNgayLamViec('23:00'),
    '23:00 to 02:30 should be valid overnight shift'
);

// Inverted times should fail
assert.ok(
    phutTrongNgayLamViec('10:00') <= phutTrongNgayLamViec('22:00'),
    'End time earlier than start time should fail'
);

assert.ok(
    phutTrongNgayLamViec('17:00') <= phutTrongNgayLamViec('01:00'),
    '01:00 to 17:00 in same workday should fail'
);
console.log('✅ Business date cutoff calculations passed all cases.\n');

// ── Test 3: Zod schema validation for OVERTIME payload ──
console.log('Test Suite 3: AttendanceSchema validation for extensionMinutes');

// Valid cases
const valid60 = AttendanceSchema.safeParse({
    employeeId: '550e8400-e29b-41d4-a716-446655440000',
    checkType: 'OVERTIME',
    extensionMinutes: 60,
});
assert.ok(valid60.success, 'extensionMinutes = 60 should be valid');

const valid90String = AttendanceSchema.safeParse({
    employeeId: '550e8400-e29b-41d4-a716-446655440000',
    checkType: 'OVERTIME',
    extensionMinutes: '90',
});
assert.ok(valid90String.success, 'extensionMinutes = "90" string should coerce to 90');

// Invalid cases
const invalidSmall = AttendanceSchema.safeParse({
    employeeId: '550e8400-e29b-41d4-a716-446655440000',
    checkType: 'OVERTIME',
    extensionMinutes: 45,
});
assert.ok(!invalidSmall.success, 'extensionMinutes < 60 should fail');

const invalidFloat = AttendanceSchema.safeParse({
    employeeId: '550e8400-e29b-41d4-a716-446655440000',
    checkType: 'OVERTIME',
    extensionMinutes: 60.5,
});
assert.ok(!invalidFloat.success, 'extensionMinutes as float should fail');

console.log('✅ AttendanceSchema validation passed all cases.\n');

console.log('🎉 All 3 test suites passed successfully!');
