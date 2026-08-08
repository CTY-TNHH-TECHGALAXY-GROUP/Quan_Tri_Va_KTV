/**
 * Fix double-encoded UTF-8 (UTF-8 → Windows-1252 → UTF-8) in page.tsx
 * 
 * Problem: Vietnamese text like "Số" (UTF-8: E1 BB 95) was read as 
 * Windows-1252 chars (á » •), then re-encoded to UTF-8 (C3 A1 C2 BB E2 80 A2).
 * 
 * Solution: Reverse the process - convert Unicode code points back to 
 * CP1252 byte values, then decode as UTF-8.
 */

const fs = require('fs');
const path = require('path');

// Unicode → CP1252 reverse mapping for the 0x80-0x9F range
const unicodeToCp1252 = new Map([
    [0x20AC, 0x80], // €
    [0x201A, 0x82], // ‚
    [0x0192, 0x83], // ƒ
    [0x201E, 0x84], // „
    [0x2026, 0x85], // …
    [0x2020, 0x86], // †
    [0x2021, 0x87], // ‡
    [0x02C6, 0x88], // ˆ
    [0x2030, 0x89], // ‰
    [0x0160, 0x8A], // Š
    [0x2039, 0x8B], // ‹
    [0x0152, 0x8C], // Œ
    [0x017D, 0x8E], // Ž
    [0x2018, 0x91], // '
    [0x2019, 0x92], // '
    [0x201C, 0x93], // "
    [0x201D, 0x94], // "
    [0x2022, 0x95], // •
    [0x2013, 0x96], // –
    [0x2014, 0x97], // —
    [0x02DC, 0x98], // ˜
    [0x2122, 0x99], // ™
    [0x0161, 0x9A], // š
    [0x203A, 0x9B], // ›
    [0x0153, 0x9C], // œ
    [0x017E, 0x9E], // ž
    [0x0178, 0x9F], // Ÿ
]);

const filePath = path.join(__dirname, '..', 'app', 'reception', 'ktv-hub', 'page.tsx');
const backupPath = filePath + '.bak';

console.log('Reading file:', filePath);
const content = fs.readFileSync(filePath, 'utf8');
console.log('Original length:', content.length);

// Convert each character back to its CP1252 byte value
const bytes = [];
for (let i = 0; i < content.length; i++) {
    const cp = content.codePointAt(i);
    
    if (cp > 0xFFFF) {
        // Surrogate pair (emoji etc.) - this might be a double-encoded multi-byte
        // Try CP1252 reverse mapping first
        const mapped = unicodeToCp1252.get(cp);
        if (mapped !== undefined) {
            bytes.push(mapped);
        } else {
            // Keep as-is (probably actual emoji in the file)
            bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
        }
        i++; // Skip low surrogate
    } else if (cp > 0xFF) {
        // Character > 255 - check if it's a CP1252 mapping
        const mapped = unicodeToCp1252.get(cp);
        if (mapped !== undefined) {
            bytes.push(mapped);
        } else if (cp === 0xFEFF) {
            // BOM - skip it, we'll add a clean one
            continue;
        } else {
            // Some other Unicode char > 0xFF that isn't in CP1252 range
            // This might be box-drawing, emoji from comments, etc.
            // Keep as UTF-8 bytes
            bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
        }
    } else {
        // 0x00 - 0xFF: direct byte value
        bytes.push(cp);
    }
}

const fixed = Buffer.from(bytes).toString('utf8');
console.log('Fixed length:', fixed.length);

// Verification
const checks = [
    ['Sổ', 'Sổ Tua'],
    ['Sách', 'Danh Sách'],
    ['Có mặt', 'Có mặt'],
    ['Đang', 'Đang Làm'],
    ['Nghỉ phép', 'Nghỉ phép'],
    ['Sẵn Sàng', 'Sẵn Sàng'],
    ['Tổng Ca', 'Tổng Ca'],
    ['điểm danh', 'điểm danh'],
    ['hàng đợi', 'hàng đợi'],
    ['Quy Tắc', 'Quy Tắc'],
];

console.log('\n--- Verification ---');
let allPassed = true;
for (const [search, desc] of checks) {
    const found = fixed.indexOf(search) >= 0;
    console.log(`${found ? '✓' : '✗'} "${desc}": ${found ? 'FOUND' : 'NOT FOUND'}`);
    if (!found) allPassed = false;
}

if (allPassed) {
    // Create backup
    fs.copyFileSync(filePath, backupPath);
    console.log('\n✓ Backup created:', backupPath);
    
    // Write fixed content (with BOM)
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(filePath, Buffer.concat([bom, Buffer.from(fixed, 'utf8')]));
    console.log('✓ Fixed file written successfully!');
    
    // Show sample
    const idx = fixed.indexOf('Tua');
    if (idx >= 0) {
        console.log('\nSample around "Tua":', JSON.stringify(fixed.substring(idx - 10, idx + 15)));
    }
} else {
    console.log('\n⚠ Some checks failed. NOT writing file. Please review.');
    // Show samples around problem areas
    const tuaIdx = fixed.indexOf('Tua');
    if (tuaIdx >= 0) {
        console.log('Context near Tua:', JSON.stringify(fixed.substring(tuaIdx - 15, tuaIdx + 10)));
    }
}
