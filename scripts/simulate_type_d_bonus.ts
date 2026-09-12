import assert from 'assert';
import { KtvTypeDBonusService } from '../lib/services/KtvTypeDBonusService';

function runTest() {
    const base = 20;
    const rate = 1000;
    
    console.log("Running bonus assertions...");

    const pay1 = KtvTypeDBonusService.calculateBonusForTypeD(['TYPE_D'], 4, base, rate);
    assert.strictEqual(pay1, 20000);

    const pay2 = KtvTypeDBonusService.calculateBonusForTypeD(['TYPE_D', 'TYPE_D'], 4, base, rate);
    assert.strictEqual(pay2, 10000);

    const pay3 = KtvTypeDBonusService.calculateBonusForTypeD(['TYPE_D', 'TYPE_A'], 4, base, rate);
    assert.strictEqual(pay3, 0);

    const pay4 = KtvTypeDBonusService.calculateBonusForTypeD(['TYPE_D'], 3, base, rate);
    assert.strictEqual(pay4, 0);
    
    const pay5 = KtvTypeDBonusService.calculateBonusForTypeD(['TYPE_D'], 5, base, rate);
    assert.strictEqual(pay5, 20000);

    console.log("All bonus assertions passed.");
}

runTest();
