/**
 * Seed checklist Quầy hỗ trợ NH01 (Office P0 bước 6 — plans/plan_office_p0_nen_tang_checklist.md mục 7).
 *
 * Tạo / cập nhật (chạy lại bao nhiêu lần cũng được — khớp theo TÊN):
 *   - 7 nhóm việc ngày (theo khung giờ) + 1 nhóm việc tuần, 43 + 7 việc mẫu có ô ảnh có nhãn
 *   - bộ việc "Quầy hỗ trợ NH01 — Ngày" / "— Tuần"
 *   - vị trí "Quầy hỗ trợ NH01" (việc cố định: Bắt buộc làm, đột xuất: Bắt buộc làm), thành viên --member
 *   - (tuỳ chọn) --deactivate-old-routines[=name|role|all]: tắt routine cũ (is_active=false, không xoá) của thành viên
 *       name (mặc định) = trùng tên với việc của bộ · role = mọi routine không gắn phòng · all = tất cả
 *
 * Không xoá gì. Việc mẫu đã có thì CHỈ cập nhật ô ảnh / số liệu / chế độ giờ khi chưa được cấu hình
 * (photo_slots null), để không đè cấu hình admin đã chỉnh trên màn hình.
 *
 * AN TOÀN:
 *   - Mặc định CHẠY THỬ: in kế hoạch, không ghi. Thêm --apply để ghi.
 *   - Chỉ chạy trên DB TEST (eknggruuiuadwldacpmb). DB thật cần thêm --prod-approved (phải có duyệt riêng).
 *
 * Chạy (trong worktree office-p0-v1):
 *   npx ts-node -P scripts/qa/tsconfig.qa.json scripts/office/seed_nh01_checklist.ts [--apply] [--member=NH001] [--deactivate-old-routines=role]
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DAILY_BLOCKS, WEEKLY_ITEMS, MULTI_TIMES, EVIDENCE_OVERRIDES, buildPhotoSlots,
  dailyCategoryName, legacyCategoryNames, WEEKLY_CATEGORY, SET_DAY, SET_WEEK, POSITION, type Row,
} from './nh01_checklist.data';

const TEST_REF = 'eknggruuiuadwldacpmb';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD_OK = args.includes('--prod-approved');
const deactivateArg = args.find(a => a.startsWith('--deactivate-old-routines'));
const DEACTIVATE_OLD = deactivateArg ? ((deactivateArg.split('=')[1] || 'name') as 'name' | 'role' | 'all') : null;
if (DEACTIVATE_OLD && !['name', 'role', 'all'].includes(DEACTIVATE_OLD)) throw new Error('--deactivate-old-routines=name|role|all');
const MEMBER = (args.find(a => a.startsWith('--member=')) || '--member=NH001').split('=')[1];

for (const line of fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const URL_ = String(process.env.NEXT_PUBLIC_SUPABASE_URL);
const IS_TEST = URL_.includes(TEST_REF);
if (!IS_TEST && !PROD_OK) throw new Error(`DỪNG: ${URL_} không phải DB TEST. DB thật cần --prod-approved (sau khi được duyệt).`);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const log = (s: string) => console.log(s);
const must = async <T = any>(p: PromiseLike<{ data: T; error: any }>, what: string): Promise<T> => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

interface TemplateSpec {
  name: string;
  sort_order: number;
  photo_slots: { label: string }[];
  min_photo_count: number;
  time_mode: 'FREE' | 'MULTI';
  multi_times: string[] | null;
  evidence_fields: any[] | null;
  cron_schedule: string | null;
  allow_carry_over: boolean;
}

const spec = (row: Row, i: number, weeklyDays: number[] | null): TemplateSpec => {
  const [, content] = row;
  const slots = buildPhotoSlots(row);
  const multi = MULTI_TIMES[content] || null;
  return {
    name: content,
    sort_order: i,
    photo_slots: slots,
    min_photo_count: slots.length,
    time_mode: multi ? 'MULTI' : 'FREE',
    multi_times: multi,
    evidence_fields: EVIDENCE_OVERRIDES[content] || null,
    cron_schedule: weeklyDays ? weeklyDays.join(',') : null,
    // Daily routines recur tomorrow anyway — carrying yesterday's copy over would duplicate them.
    allow_carry_over: !!weeklyDays,
  };
};

async function upsertCategory(name: string, repeatMode: 'DAILY' | 'WEEKLY') {
  let found = await must<any[]>(sb.from('TaskCategories').select('id, repeat_mode').eq('name', name), `find cat ${name}`);
  if (!found.length) {
    // Rename a category created under an older name instead of creating a second one.
    const legacy = await must<any[]>(sb.from('TaskCategories').select('id, repeat_mode, name').in('name', legacyCategoryNames(name)), `find legacy ${name}`);
    if (legacy.length) {
      log(`  ~ đổi tên "${legacy[0].name}" → "${name}"`);
      if (APPLY) await must(sb.from('TaskCategories').update({ name }).eq('id', legacy[0].id).select('id'), 'rename cat');
      found = legacy;
    }
  }
  if (found.length) {
    if (found[0].repeat_mode !== repeatMode && APPLY) await must(sb.from('TaskCategories').update({ repeat_mode: repeatMode }).eq('id', found[0].id).select(), 'cat mode');
    return { id: found[0].id as string, created: false };
  }
  if (!APPLY) return { id: `(mới) ${name}`, created: true };
  const [row] = await must<any[]>(sb.from('TaskCategories').insert({ name, type: 'ROLE', repeat_mode: repeatMode }).select('id'), `insert cat ${name}`);
  return { id: row.id as string, created: true };
}

const stats = { catNew: 0, tplNew: 0, tplConfigured: 0, tplKept: 0 };

async function upsertTemplates(categoryId: string, specs: TemplateSpec[]) {
  const existing = categoryId.startsWith('(mới)') ? [] : await must<any[]>(
    sb.from('TaskTemplates').select('id, name, photo_slots, is_active').eq('category_id', categoryId), 'list tpl');
  for (const s of specs) {
    const cur = existing.find(e => e.name === s.name);
    const config = {
      photo_slots: s.photo_slots, min_photo_count: s.min_photo_count, requires_photo: true,
      time_mode: s.time_mode, multi_times: s.multi_times, evidence_fields: s.evidence_fields,
      blocks_checkout: true, requires_review: true, allow_carry_over: s.allow_carry_over,
    };
    if (!cur) {
      stats.tplNew++;
      if (APPLY) await must(sb.from('TaskTemplates').insert({
        category_id: categoryId, name: s.name, sort_order: s.sort_order, cron_schedule: s.cron_schedule, is_active: true, ...config,
      }).select('id'), `insert tpl ${s.name}`);
    } else if (!cur.photo_slots) {
      stats.tplConfigured++;
      if (APPLY) await must(sb.from('TaskTemplates').update({ sort_order: s.sort_order, cron_schedule: s.cron_schedule, is_active: true, ...config }).eq('id', cur.id).select('id'), `update tpl ${s.name}`);
    } else {
      stats.tplKept++;   // admin already configured it on screen — leave as is
    }
  }
}

async function upsertSet(name: string, description: string, categoryIds: string[]) {
  const found = await must<any[]>(sb.from('OfficeTemplateSets').select('id').eq('name', name), 'find set');
  if (!APPLY) return found[0]?.id || `(mới) ${name}`;
  const id = found[0]?.id || (await must<any[]>(sb.from('OfficeTemplateSets').insert({ name, description }).select('id'), 'insert set'))[0].id;
  await must(sb.from('OfficeTemplateSetCategories').delete().eq('set_id', id).select(), 'clear set cats');
  await must(sb.from('OfficeTemplateSetCategories').insert(categoryIds.map((category_id, i) => ({ set_id: id, category_id, sort_order: i }))).select(), 'set cats');
  return id as string;
}

async function main() {
  log(`=== Seed NH01 — ${IS_TEST ? 'DB TEST' : '⚠️ DB THẬT'} — ${APPLY ? 'GHI' : 'CHẠY THỬ (không ghi)'} — thành viên ${MEMBER} ===`);

  // 1. Categories + templates
  const dailyCatIds: string[] = [];
  for (const [i, block] of DAILY_BLOCKS.entries()) {
    const name = dailyCategoryName(block, i);
    const cat = await upsertCategory(name, 'DAILY');
    if (cat.created) stats.catNew++;
    dailyCatIds.push(cat.id);
    await upsertTemplates(cat.id, block.items.map((row, j) => spec(row, j, null)));
    log(`  ${cat.created ? '+' : '='} ${name}: ${block.items.length} việc`);
  }
  const weeklyCat = await upsertCategory(WEEKLY_CATEGORY, 'WEEKLY');
  if (weeklyCat.created) stats.catNew++;
  await upsertTemplates(weeklyCat.id, WEEKLY_ITEMS.map((w, j) => spec(w.row, j, w.days)));
  log(`  ${weeklyCat.created ? '+' : '='} ${WEEKLY_CATEGORY}: ${WEEKLY_ITEMS.length} việc`);

  // 2. Template sets
  const setDay = await upsertSet(SET_DAY, 'Checklist hằng ngày quầy hỗ trợ NH01', dailyCatIds);
  const setWeek = await upsertSet(SET_WEEK, 'Việc theo thứ trong tuần quầy hỗ trợ NH01', [weeklyCat.id]);

  // 3. Position — MANDATORY is the decision for NH001 (08/10/2026); admin may change it on screen later.
  const staff = await must<any[]>(sb.from('Staff').select('id, full_name, status').eq('id', MEMBER), 'staff');
  if (!staff.length) log(`  ⚠️ Không có Staff ${MEMBER} trên DB này — vị trí tạo không có thành viên.`);
  const foundPos = await must<any[]>(sb.from('OfficePositions').select('id, fixed_accept_policy, adhoc_accept_policy').eq('name', POSITION), 'find pos');
  let posId = foundPos[0]?.id as string | undefined;
  if (APPLY) {
    if (!posId) {
      posId = (await must<any[]>(sb.from('OfficePositions').insert({
        name: POSITION, branch: 'NH01', fixed_accept_policy: 'MANDATORY', adhoc_accept_policy: 'MANDATORY', is_active: true,
      }).select('id'), 'insert pos'))[0].id;
    }
    await must(sb.from('OfficePositionTemplateSets').upsert(
      [setDay, setWeek].map(set_id => ({ position_id: posId, set_id })), { onConflict: 'position_id,set_id' }).select(), 'pos sets');
    if (staff.length) {
      await must(sb.from('OfficePositionMembers').upsert({ position_id: posId, staff_id: MEMBER, is_active: true }, { onConflict: 'position_id,staff_id' }).select(), 'member');
    }
  }
  log(`  ${foundPos.length ? '=' : '+'} Vị trí "${POSITION}"${foundPos.length ? ` (giữ cấu hình nhận việc hiện tại: ${foundPos[0].fixed_accept_policy}/${foundPos[0].adhoc_accept_policy})` : ' — Bắt buộc làm / Bắt buộc làm'}`);

  // 4. Old personal routines of the member that the set now covers (same template name).
  const users = await must<any[]>(sb.from('Users').select('id').or(`id.eq.${MEMBER},code.eq.${MEMBER}`), 'users');
  const userIds = users.map(u => u.id);
  const setNames = new Set([...DAILY_BLOCKS.flatMap(b => b.items.map(r => r[1])), ...WEEKLY_ITEMS.map(w => w.row[1])]);
  const routines = userIds.length ? await must<any[]>(
    sb.from('EmployeeRoutines').select('id, mode, room_id, TaskTemplates(name)').in('employee_id', userIds).eq('is_active', true), 'routines') : [];
  const own = routines.filter(r => r.mode !== 'EXCLUDE');
  const sameName = own.filter(r => setNames.has(r.TaskTemplates?.name));
  const roleBased = own.filter(r => !r.room_id);
  log(`  Routine cũ đang bật của ${MEMBER}: ${own.length} (trùng tên bộ việc ${sameName.length} · không gắn phòng ${roleBased.length} · theo phòng ${own.length - roleBased.length})`);
  if (DEACTIVATE_OLD) {
    const target = DEACTIVATE_OLD === 'all' ? own : DEACTIVATE_OLD === 'role' ? roleBased : sameName;
    if (APPLY && target.length) await must(sb.from('EmployeeRoutines').update({ is_active: false }).in('id', target.map(r => r.id)).select('id'), 'deactivate');
    log(`  → [${DEACTIVATE_OLD}] ${APPLY ? 'đã tắt' : 'sẽ tắt'} ${target.length} routine (is_active=false, không xoá)`);
  }

  log(`\nTổng: nhóm việc mới ${stats.catNew}, việc mẫu mới ${stats.tplNew}, việc cũ được cấu hình ô ảnh ${stats.tplConfigured}, việc giữ nguyên (admin đã cấu hình) ${stats.tplKept}`);
  if (!APPLY) log('CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi.');
}

main().catch(e => { console.error('LỖI:', e.message || e); process.exitCode = 1; });
