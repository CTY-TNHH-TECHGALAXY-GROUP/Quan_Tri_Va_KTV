import assert from 'assert';
import { KtvTypeDCommissionService } from '../lib/services/KtvTypeDCommissionService';

function runTest() {
    const ratePer60 = 100000;
    const techCode = 'T001';
    const deductions = { "4": 0, "3": 0.25, "2": 0.5, "1": 0.75, "0": 0 };

    console.log("Running assertions...");

    // Case 1: GÃ¡n 60p, xong 50p -> 50p, rating 4
    const items1 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60,
            actualStartTime: '2026-09-01T10:00:00Z',
            actualEndTime: '2026-09-01T10:50:00Z'
        }]
    }];
    const pay1 = KtvTypeDCommissionService.calculateGuestCommission(items1, techCode, 4, ratePer60, deductions);
    console.log(`Case 1: ${pay1}`);
    assert.strictEqual(pay1, 83333);

    // Case 2: GÃ¡n 60p, xong 65p -> 60p, rating 4
    const items2 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60,
            actualStartTime: '2026-09-01T10:00:00Z',
            actualEndTime: '2026-09-01T11:05:00Z'
        }]
    }];
    const pay2 = KtvTypeDCommissionService.calculateGuestCommission(items2, techCode, 4, ratePer60, deductions);
    console.log(`Case 2: ${pay2}`);
    assert.strictEqual(pay2, 100000);

    // Case 3: Missing timestamps -> Fallback to gan (60)
    const items3 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60
            // No timestamps
        }]
    }];
    const pay3 = KtvTypeDCommissionService.calculateGuestCommission(items3, techCode, 4, ratePer60, deductions);
    console.log(`Case 3 (Missing timestamps): ${pay3}`);
    assert.strictEqual(pay3, 100000);

    // Case 4: customCommissionDuration overrides
    const items4 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60,
            customCommissionDuration: 30, // should take 30
            actualStartTime: '2026-09-01T10:00:00Z',
            actualEndTime: '2026-09-01T11:05:00Z'
        }]
    }];
    const pay4 = KtvTypeDCommissionService.calculateGuestCommission(items4, techCode, 4, ratePer60, deductions);
    console.log(`Case 4 (Custom duration 30): ${pay4}`);
    assert.strictEqual(pay4, 50000);

    // Case 5: string segment + lowercase ktvId
    const items5 = [{
        segments: "[{\"ktvId\":\"t001\",\"duration\":90,\"actualStartTime\":\"2026-09-01T05:00:00Z\",\"actualEndTime\":\"2026-09-01T06:30:00Z\"}]"
    }];
    const pay5 = KtvTypeDCommissionService.calculateGuestCommission(items5, techCode, 4, ratePer60, deductions);
    console.log(`Case 5 (String JSON & Lowercase ID): ${pay5}`);
    assert.strictEqual(pay5, 150000); // 90 mins * 100000/60 = 150000


    // Case 6: rating 3 sao -> phai ra 75% tien goc (25% deduction)
    const items6 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60,
            actualStartTime: '2026-09-01T10:00:00Z',
            actualEndTime: '2026-09-01T11:00:00Z'
        }]
    }];
    const pay6 = KtvTypeDCommissionService.calculateGuestCommission(items6, techCode, 3, ratePer60, deductions);
    console.log(`Case 6 (Rating 3): ${pay6}`);
    assert.strictEqual(pay6, 75000);

    // Case 7: rating 0 sao (chua cham) -> phai ra 100% tien goc
    const items7 = [{
        segments: [{
            ktvId: 'T001',
            duration: 60,
            actualStartTime: '2026-09-01T10:00:00Z',
            actualEndTime: '2026-09-01T11:00:00Z'
        }]
    }];
    const pay7 = KtvTypeDCommissionService.calculateGuestCommission(items7, techCode, 0, ratePer60, deductions);
    console.log(`Case 7 (Rating 0): ${pay7}`);
    assert.strictEqual(pay7, 100000);

    console.log("All commission assertions passed.");
}


runTest();
