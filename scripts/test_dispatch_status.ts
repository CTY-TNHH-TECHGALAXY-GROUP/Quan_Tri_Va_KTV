import { canTransition, RawStatus } from '../lib/dispatch-status';

const tests = [
  // 1. Valid forward transitions
  { from: 'PREPARING', to: 'IN_PROGRESS', expected: true },
  { from: 'IN_PROGRESS', to: 'CLEANING', expected: true },
  { from: 'CLEANING', to: 'FEEDBACK', expected: true },
  { from: 'FEEDBACK', to: 'DONE', expected: true },
  
  // 2. Jumping (skipping) - Allowed if moving forward
  { from: 'PREPARING', to: 'CLEANING', expected: true },
  { from: 'IN_PROGRESS', to: 'DONE', expected: true },
  
  // 3. Backward transitions - Blocked
  { from: 'IN_PROGRESS', to: 'PREPARING', expected: false },
  { from: 'CLEANING', to: 'IN_PROGRESS', expected: false },
  { from: 'FEEDBACK', to: 'CLEANING', expected: false },
  { from: 'DONE', to: 'FEEDBACK', expected: false },
  
  // 4. Terminal states - Blocked
  { from: 'DONE', to: 'PREPARING', expected: false },
  { from: 'CANCELLED', to: 'PREPARING', expected: false },
  { from: 'DONE', to: 'IN_PROGRESS', expected: false },

  // 5. Legacy states properly normalized
  { from: 'WAITING', to: 'IN_PROGRESS', expected: true }, // WAITING -> PREPARING. PREPARING -> IN_PROGRESS: true
  { from: 'COMPLETED', to: 'IN_PROGRESS', expected: false }, // COMPLETED -> CLEANING. CLEANING -> IN_PROGRESS: false (backward)
  { from: 'COMPLETED', to: 'FEEDBACK', expected: true }, // COMPLETED -> CLEANING. CLEANING -> FEEDBACK: true
  { from: 'waiting_rating', to: 'DONE', expected: true }, // waiting_rating -> FEEDBACK. FEEDBACK -> DONE: true
  { from: 'waiting_rating', to: 'CLEANING', expected: false }, // waiting_rating -> FEEDBACK. FEEDBACK -> CLEANING: false
  { from: 'cancelled', to: 'PREPARING', expected: false }, // lowercase cancelled must still be terminal
  
  // 6. Same state
  { from: 'IN_PROGRESS', to: 'IN_PROGRESS', expected: true },
  { from: 'COMPLETED', to: 'CLEANING', expected: true } // Same normalized index
];

let failed = 0;

for (const t of tests) {
  const result = canTransition(t.from as any, t.to as RawStatus);
  if (result !== t.expected) {
    console.error(`❌ FAILED: ${t.from} -> ${t.to}. Expected ${t.expected}, got ${result}`);
    failed++;
  } else {
    console.log(`✅ PASSED: ${t.from} -> ${t.to}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll tests passed successfully!`);
}
