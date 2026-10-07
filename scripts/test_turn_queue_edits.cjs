const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('pglite-2');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

(async () => {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE "TurnQueue"(id text PRIMARY KEY,date date,employee_id text,check_in_order integer,queue_position integer,manual_adjustment integer DEFAULT 0,turns_completed integer DEFAULT 0,status text);
      CREATE TABLE "TurnLedger"(date date,employee_id text,is_punished boolean);
      INSERT INTO "TurnQueue"(id,date,employee_id,check_in_order,queue_position,status) VALUES
      ('a','2026-09-27','A',1,1,'working'),('b','2026-09-27','B',2,2,'waiting'),('c','2026-09-28','C',1,1,'off');
      INSERT INTO "TurnLedger" VALUES('2026-09-27','A',false),('2026-09-27','A',true);`);
    await db.exec(read('supabase/migrations/20260927210000_turn_queue_edits.sql'));
    const rows = async () => (await db.query('SELECT * FROM "TurnQueue" ORDER BY id')).rows;
    const call = async (action, payload, date = '2026-09-27') => (await db.query('SELECT turn_queue_apply_edits($1,$2,$3) AS r', [date, action, JSON.stringify(payload)])).rows[0].r;
    const original = await rows();
    await assert.rejects(call('ORDER', [{ id: 'a', expectedOrder: 1, expectedPosition: 1, order: 2 }, { id: 'b', expectedOrder: 99, expectedPosition: 2, order: 1 }]), /nơi khác/);
    assert.deepEqual(await rows(), original, 'second-row failure rolls back first-row update');
    await assert.rejects(call('RESET', [{ id: 'a', expectedOrder: 1, expectedPosition: 1, order: 2 }, { id: 'c', expectedOrder: 1, expectedPosition: 1, order: 1 }]), /Hàng đợi/);
    assert.deepEqual(await rows(), original, 'reset cannot alter another date and rolls back');
    assert.equal((await call('ORDER', [{ id: 'a', expectedOrder: 1, expectedPosition: 1, order: 2 }, { id: 'b', expectedOrder: 2, expectedPosition: 2, order: 1 }])).updated, 2);
    await call('RESET', [{ id: 'a', expectedOrder: 2, expectedPosition: 2, order: 1 }, { id: 'b', expectedOrder: 1, expectedPosition: 1, order: 2 }]);
    assert.deepEqual((await rows()).slice(0, 2).map(r => [r.check_in_order, r.queue_position]), [[2, 1], [1, 2]], 'reset preserves attendance order');
    await Promise.all([call('DELTA', { employeeId: 'A', delta: 1 }), call('DELTA', { employeeId: 'A', delta: 1 })]);
    assert.equal((await rows())[0].manual_adjustment, 2, 'two requests increment the DB value, never a stale UI value');
    assert.equal((await rows())[0].turns_completed, 3, 'punished ledger does not count');
    await call('DELTA', { employeeId: 'B', delta: -1 });
    await call('DELTA', { employeeId: 'B', delta: 1 });
    assert.equal((await rows())[1].turns_completed, 0, 'negative manual balance stays clamped after returning to zero');
    for (const payload of [{ employeeId: 'A' }, { employeeId: 'A', delta: 2 }, { employeeId: 'missing', delta: 1 }]) await assert.rejects(call('DELTA', payload));
    const access = (await db.query(`SELECT has_function_privilege('service_role','turn_queue_apply_edits(date,text,jsonb)','EXECUTE') AS server,has_function_privilege('authenticated','turn_queue_apply_edits(date,text,jsonb)','EXECUTE') AS client`)).rows[0];
    assert.deepEqual(access, { server: true, client: false });
    await db.close();

    // Execute the real server action with denied session/permission and RPC error.
    const actionModule = { exports: {} };
    let authorized = true, permission = true, rpcError = null, calls = 0;
    const dependencies = {
      '@/lib/auth-server': { requireBusinessUser: async () => authorized ? { businessUserId: 'admin' } : null, requirePermission: async name => { assert.equal(name, 'turn_tracking'); if (!permission) throw new Error('Forbidden'); } },
      '@/lib/supabaseAdmin': { getSupabaseAdmin: () => ({ rpc: async () => { calls++; return { data: { success: true }, error: rpcError }; } }) }
    };
    vm.runInNewContext(ts.transpile(read('components/shared/TurnQueueBoard/actions.ts'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), { module: actionModule, exports: actionModule.exports, require: name => dependencies[name] });
    const save = actionModule.exports.saveTurnQueueEdits;
    authorized = false; assert.equal((await save('2026-09-27', 'ORDER', [])).success, false); assert.equal(calls, 0);
    authorized = true; permission = false; assert.equal((await save('2026-09-27', 'ORDER', [])).success, false); assert.equal(calls, 0);
    permission = true; rpcError = { message: 'stale order' }; assert.equal((await save('2026-09-27', 'ORDER', [])).error, 'stale order');
    rpcError = null; assert.equal((await save('2026-09-27', 'ORDER', [])).success, true);
    // Execute the actual hook: drafts stay local, failures keep them, realtime patches status only.
    const storage = new Map(), events = new Map(), realtime = new Map();
    const serverRows = [
      { id: 'a', employee_id: 'A', check_in_order: 1, queue_position: 1, status: 'waiting', date: '2026-09-27' },
      { id: 'b', employee_id: 'B', check_in_order: 2, queue_position: 2, status: 'waiting', date: '2026-09-27' }
    ];
    let hookResult = { success: false, error: 'network failed' }, hookCalls = 0, pendingResolve;
    const chain = { select() { return this; }, eq() { return this; }, single() { return Promise.resolve({ data: null }); }, then(fn) { return Promise.resolve({ data: [] }).then(fn); } };
    const fakeSupabase = { from: () => chain, channel() { return { on(_type, filter, callback) { realtime.set(filter.table, callback); return this; }, subscribe() { return this; } }; }, removeChannel() {} };
    function mountHook() {
      let index = 0, dirty = true, pendingEffects = [], api;
      const cells = [], changed = (old, next) => !old || !next || old.length !== next.length || old.some((value, i) => value !== next[i]);
      const cell = factory => { const id = index++; return cells[id] || (cells[id] = factory()); };
      const React = {
        useState(initial) { const ref = cell(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [ref.value, update => { const value = typeof update === 'function' ? update(ref.value) : update; if (value !== ref.value) { ref.value = value; dirty = true; } }]; },
        useRef(initial) { return cell(() => ({ current: initial })); },
        useCallback(fn, deps) { const ref = cell(() => ({})); if (changed(ref.deps, deps)) { ref.value = fn; ref.deps = deps; } return ref.value; },
        useEffect(fn, deps) { const ref = cell(() => ({})); if (changed(ref.deps, deps)) { ref.deps = deps; pendingEffects.push(() => { ref.cleanup?.(); ref.cleanup = fn(); }); } }
      };
      const deps = {
        react: React, '@/lib/supabase': { supabase: fakeSupabase }, '@/lib/constants/staffStatus': { STAFF_STATUS: { WORKING: 'working' } },
        '@/lib/constants/staff.constants': { isPlaceholderStaffId: () => false, isTypeCWorkType: value => value === 'TYPE_C' },
        './actions': { saveTurnQueueEdits: async (_date, action, payload) => {
          hookCalls++;
          if (hookResult === 'pending') return new Promise(resolve => { pendingResolve = resolve; });
          if (hookResult.success && action === 'ORDER') for (const edit of payload) { const row = serverRows.find(r => r.id === edit.id); row.check_in_order = edit.order; row.queue_position = edit.order; }
          return hookResult;
        } }
      };
      const mod = { exports: {} };
      vm.runInNewContext(ts.transpile(read('components/shared/TurnQueueBoard/TurnQueueBoard.logic.ts'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), {
        module: mod, exports: mod.exports, require: name => deps[name], console: { log() {}, error() {} }, Date,
        sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); } },
        fetch: async () => ({ json: async () => ({ success: true, data: structuredClone(serverRows) }) })
      });
      const staffs = [{ id: 'A' }, { id: 'B' }];
      const settle = () => { for (let n = 0; dirty; n++) { assert.ok(n < 25, 'hook effects settle'); dirty = false; index = 0; pendingEffects = []; api = mod.exports.useTurnQueueBoard(staffs, 'admin'); for (const effect of pendingEffects) effect(); } return api; };
      const flush = async () => { for (let n = 0; n < 8; n++) { await Promise.resolve(); settle(); } return api; };
      return { get api() { return settle(); }, flush, close() { for (const ref of cells) ref.cleanup?.(); } };
    }
    let hook = mountHook(); await hook.flush();
    hook.api.handleOrderChange('A', 2); assert.equal(hook.api.hasChanges, true); assert.equal(hookCalls, 0); assert.equal(storage.size, 1);
    serverRows[1].status = 'working'; realtime.get('TurnQueue')(); await hook.flush();
    assert.equal(hook.api.sortedTurns.find(r => r.employee_id === 'B').status, 'working');
    assert.equal(hook.api.sortedTurns.find(r => r.employee_id === 'A').check_in_order, 2, 'realtime does not overwrite order draft');
    await hook.api.saveOrder(); assert.equal(hook.api.hasChanges, true); assert.equal(storage.size, 1); assert.equal(hook.api.saveMessage, 'network failed');
    const warn = { preventDefault() { this.warned = true; } }; events.get('beforeunload')(warn); assert.equal(warn.warned, true);
    hookResult = 'pending'; const beforeCalls = hookCalls; const firstSave = hook.api.saveOrder(); await hook.api.saveOrder();
    assert.equal(hookCalls, beforeCalls + 1, 'double Save submits only one request');
    pendingResolve({ success: false, error: 'retry failed' }); await firstSave; assert.equal(hook.api.hasChanges, true);
    hook.close(); hook = mountHook(); await hook.flush(); assert.equal(hook.api.hasChanges, true); assert.equal(hook.api.sortedTurns.find(r => r.id === 'a').check_in_order, 2, 'restore order draft after remount');
    hookResult = { success: true }; await hook.api.saveOrder(); await hook.flush(); assert.equal(hook.api.hasChanges, false); assert.equal(storage.size, 0);
    hook.api.handleOrderChange('A', 1); assert.equal(hook.api.hasChanges, true); hook.api.handleOrderChange('A', 2); assert.equal(hook.api.hasChanges, false, 'returning to baseline clears dirty');
    assert.equal(storage.size, 0); hook.close();
    console.log('PASS TurnQueue: atomic order/reset rollback, stale/date guards, concurrent DB delta, ledger clamp, server permissions/error handling, real hook cache/dirty/error/realtime/pending');
})().catch(error => { console.error(error); process.exitCode = 1; });
