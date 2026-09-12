const fs = require('fs');

function replace(f, map) {
    let code = fs.readFileSync(f, 'utf8');
    for (const [k, v] of Object.entries(map)) {
        code = code.split(k).join(v);
    }
    fs.writeFileSync(f, code);
}

replace('app/api/ktv/wallet/timeline/route.ts', {
    "ledgers.filter(l =>": "ledgers.filter((l: any) =>",
    "pastLedgers.forEach(l =>": "pastLedgers.forEach((l: any) =>"
});
