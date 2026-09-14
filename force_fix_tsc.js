const fs = require('fs');

function replace(f, map) {
    let code = fs.readFileSync(f, 'utf8');
    for (const [k, v] of Object.entries(map)) {
        // use split join to replace all
        code = code.split(k).join(v);
    }
    fs.writeFileSync(f, code);
}

replace('app/api/ktv/wallet/bonus/balance/route.ts', {
    "(earns || []).reduce((sum, record) =>": "(earns || []).reduce((sum: number, record: any) =>",
    "(adjustments || []).forEach(tx =>": "(adjustments || []).forEach((tx: any) =>",
    "(withdrawals || []).reduce((sum, record) =>": "(withdrawals || []).reduce((sum: number, record: any) =>"
});

replace('app/api/ktv/wallet/bonus/timeline/route.ts', {
    "(earns || []).forEach(e =>": "(earns || []).forEach((e: any) =>",
    "(adjs || []).forEach(a =>": "(adjs || []).forEach((a: any) =>",
    "(wths || []).forEach(w =>": "(wths || []).forEach((w: any) =>"
});

replace('app/api/ktv/wallet/timeline/route.ts', {
    "(ledgers || []).reduce((sum, l) =>": "(ledgers || []).reduce((sum: number, l: any) =>",
    "(ledgers || []).forEach(l =>": "(ledgers || []).forEach((l: any) =>",
    "(adjustments || []).forEach(a =>": "(adjustments || []).forEach((a: any) =>",
    "(withdrawals || []).forEach(w =>": "(withdrawals || []).forEach((w: any) =>"
});
