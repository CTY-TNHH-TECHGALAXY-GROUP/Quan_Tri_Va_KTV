import assert from 'node:assert/strict';
import { displayBookingCode } from '../lib/booking-display-code.ts';

assert.equal(displayBookingCode('WB-30092026-007'), 'WB-30092026-007');
assert.equal(displayBookingCode('007-30092026'), '007');
assert.equal(displayBookingCode(null), '');
