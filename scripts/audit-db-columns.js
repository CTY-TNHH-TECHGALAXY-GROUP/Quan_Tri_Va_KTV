/**
 * Rà tên cột: đối chiếu mọi .from('Bang').select('cot,...') trong mã nguồn với
 * information_schema. Sai tên cột = truy vấn lỗi lúc chạy, mà phần lớn nơi gọi
 * không hứng `error` nên tính năng chết âm thầm.
 *
 * CHAY:  node scripts/audit-db-columns.js
 *
 * GIOI HAN: chi soat truy van co liet ke cot ro rang. Bo qua select('*'),
 * chuoi dong co ${}, va cac khoi nhung nhieu tang. Bao xong VAN PHAI kiem
 * lai tung cho bang mat — parser co the bat nham khoi nhung viet nhieu dong.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const ROOTS = ['app', 'lib', 'components'];
const files = [];
for (const r of ROOTS) if (fs.existsSync(r)) (function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(r);

// .from('Bang') ... .select(`...`) gần nhau
const RE = /\.from\(\s*['"`]([A-Za-z_][\w]*)['"`]\s*\)([\s\S]{0,400}?)\.select\(\s*(['"`])([\s\S]*?)\3/g;

const found = []; // {file, line, table, cols[]}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = RE.exec(src))) {
    const [full, table, between, , colsRaw] = m;
    if (/\.from\(/.test(between)) continue;           // bắt nhầm cặp khác
    if (colsRaw.includes('*')) continue;               // select('*') không cần soát
    if (colsRaw.includes('${')) continue;              // chuỗi động, bỏ qua
    const line = src.slice(0, m.index).split('\n').length;

    // Bỏ phần embed quan hệ: Ten(...) hoặc alias:Ten!fk(...)
    // Bo HAN cac khoi nhung `Ten(...)` — ten bang nhung khong phai cot.
    let s = colsRaw.replace(/\s+/g, ' ');
    let prev;
    do { prev = s; s = s.replace(/[A-Za-z_][\w]*(?:!\w+)?\([^()]*\)/g, ''); } while (s !== prev);
    let depth = 0, buf = '', top = [];
    for (const ch of s) {
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth--; continue; }
      if (depth > 0) continue;
      if (ch === ',') { top.push(buf); buf = ''; } else buf += ch;
    }
    top.push(buf);

    const cols = top.map(c => c.trim()).filter(Boolean)
      .filter(c => !/[:!]/.test(c))        // alias / embed → bỏ
      .filter(c => !c.includes('.'))       // đường dẫn lồng → bỏ
      .map(c => c.replace(/['"`]/g, '').trim())
      .filter(c => /^[A-Za-z_][\w]*$/.test(c));
    if (cols.length) found.push({ file: f, line, table, cols });
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const { rows } = await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`);
  await c.end();

  const schema = new Map();
  for (const r of rows) {
    if (!schema.has(r.table_name)) schema.set(r.table_name, new Set());
    schema.get(r.table_name).add(r.column_name);
  }

  const bad = [];
  for (const q of found) {
    if (!schema.has(q.table)) continue;                 // view / bảng lạ → bỏ
    // Ten trung voi mot BANG khac thi gan nhu chac chan la khoi nhung viet nhieu
    // dong (Bookings(...), Services(...)) ma parser chua gop het — khong bao.
    const missing = q.cols.filter(col => !schema.get(q.table).has(col) && !schema.has(col));
    if (missing.length) bad.push({ ...q, missing });
  }

  console.log(`Quét ${files.length} file, ${found.length} truy vấn có liệt kê cột.`);
  console.log(`\n=== TRUY VẤN GỌI CỘT KHÔNG TỒN TẠI: ${bad.length} ===\n`);
  for (const b of bad) {
    console.log(`${b.file}:${b.line}`);
    console.log(`   .from('${b.table}')  →  thiếu: ${b.missing.join(', ')}`);
  }
})();
