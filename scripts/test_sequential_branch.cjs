// One command for the branch's local regression gates. No network or shared DB.
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const tests = [
  'test_sequential_flows.cjs', 'test_sequential_accounts.cjs', 'test_sequential_b_redispatch.cjs',
  'test_dispatch_actual_time.cjs', 'test_sequential_finish_persistence.cjs',
  'test_sequential_finish_atomic_sql.cjs', 'test_sequential_patch_errors.cjs', 'test_sequential_sql.cjs',
  'test_sequential_employee_consistency.cjs', 'test_sequential_live_segments.cjs',
  'test_sequential_inline_ui.cjs', 'test_sequential_midnight_metadata.cjs',
  'test_sequential_notifications.cjs', 'test_sequential_deep_fixes.cjs',
  'test_sequential_lifecycle.cjs', 'test_sequential_status_entrypoints.cjs',
  'test_ktv_room_procedures.cjs', 'test_dispatch_staff_row.cjs',
  'test_dispatch_form_state.cjs', 'test_dispatch_form_sql.cjs',
  'test_dispatch_commit_sql.cjs', 'test_dispatch_confirm_ux.cjs', 'test_sequential_no_overlap_proposal.cjs',
];
for (const name of tests) {
  const result = spawnSync(process.execPath, [resolve(__dirname, name)], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || String(result.error || ''));
    process.exit(result.status || 1);
  }
  console.log('PASS ' + name);
}
for (const [name, args] of [
  ['dispatch live guard', [require.resolve('ts-node/dist/bin.js'), '-P', 'scripts/qa/tsconfig.qa.json', '-r', 'tsconfig-paths/register', 'scripts/test_dispatch_live_guard.ts']],
  ['TypeScript', [require.resolve('typescript/bin/tsc'), '--noEmit', '--incremental', 'false']],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || String(result.error || ''));
    process.exit(result.status || 1);
  }
  console.log('PASS ' + name);
}
console.log(`PASS all ${tests.length} regression scripts + live guard + TypeScript`);
