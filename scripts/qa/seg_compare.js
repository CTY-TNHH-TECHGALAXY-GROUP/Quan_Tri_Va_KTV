/** So 2 ảnh chụp seg_snapshot: node scripts/qa/seg_compare.js before.json after.json */
const fs = require('fs'); const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const rows = []; const check = (label, ok, d) => rows.push({ kiem_tra: label, ket_qua: ok ? 'ĐẠT' : 'HỎNG', chi_tiet: d });
for (const t of Object.keys(a.tables)) check(`Số dòng ${t}`, a.tables[t] === b.tables[t], `${a.tables[t]} → ${b.tables[t]}`);
check('Tổng dispatchRevision (form quầy không bị "đơn đã đổi")', a.rev_sum === b.rev_sum, `${a.rev_sum} → ${b.rev_sum}`);
check('Tổng mục lịch sử điều phối', a.hist_sum === b.hist_sum, `${a.hist_sum} → ${b.hist_sum}`);
check('Checksum NỘI DUNG chặng toàn bảng', a.content_md5 === b.content_md5, `${a.content_md5.slice(0, 8)} → ${b.content_md5.slice(0, 8)}`);
const diff = Object.keys(a.rowHashes).filter(id => a.rowHashes[id] !== b.rowHashes[id]);
check('Nội dung chặng từng dòng', diff.length === 0, `${Object.keys(a.rowHashes).length} dòng, khác: ${diff.length}${diff.length ? ' ' + diff.slice(0, 3).join(',') : ''}`);
check('Còn dạng chuỗi = chỉ dòng đang làm', b.str === b.str_running, `chuỗi ${a.str} → ${b.str} (đang làm ${b.str_running})`);
console.table(rows); console.log(rows.every(r => r.ket_qua === 'ĐẠT') ? '=== DAT ===' : '=== HONG ===');
