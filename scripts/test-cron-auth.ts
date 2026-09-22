import assert from 'node:assert/strict';
import { requireCronAuth } from '../lib/cron-auth';

if (process.env.CRON_SECRET) {
  throw new Error('Run this test without a configured CRON_SECRET');
}

const request = (authorization?: string) => new Request('http://localhost/api/cron/test', {
  headers: authorization ? { authorization } : {},
});

assert.equal(requireCronAuth(request())?.status, 401);
assert.equal(requireCronAuth(request('Bearer test-only-cron-token'))?.status, 401);

process.env.CRON_SECRET = 'test-only-cron-token';
try {
  assert.equal(requireCronAuth(request())?.status, 401);
  assert.equal(requireCronAuth(request('Bearer wrong'))?.status, 401);
  assert.equal(requireCronAuth(request('Bearer test-only-cron-token-extra'))?.status, 401);
  assert.equal(requireCronAuth(request('Bearer test-only-cron-token')), null);
} finally {
  delete process.env.CRON_SECRET;
}

console.log('Cron authentication checks passed');
