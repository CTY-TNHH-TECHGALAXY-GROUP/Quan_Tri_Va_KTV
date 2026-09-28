const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,'../app/ktv/dashboard/KTVDashboard.logic.ts'),'utf8');
const defaults = source.slice(source.indexOf('const DEFAULT_PREP_PROCEDURE'),source.indexOf('// 🚩 ROOM ISSUE'));
const procedures = source.slice(source.indexOf('    const prepProcedure:'),source.indexOf('    // === STATE SCREEN: HANDOVER'));
const completion = source.match(/const isChecklistComplete = [^;]+;/)[0];
const code = ts.transpileModule(defaults + procedures + completion + '\nreturn {prepProcedure,cleanProcedure,isChecklistComplete};',
  {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const resolve = new Function('booking','prepChecklist',code);
for (const invalid of [undefined,null,[],{},'']) {
  const result = resolve({roomPrepProcedure:invalid,roomCleanProcedure:invalid},[]);
  assert.equal(result.prepProcedure.length,5);assert.equal(result.cleanProcedure.length,4);
  assert.equal(result.isChecklistComplete,false);
  assert.equal(resolve({roomPrepProcedure:invalid},result.prepProcedure.map(()=>true)).isChecklistComplete,true);
}
const custom = resolve({roomPrepProcedure:['Chuẩn bị riêng'],roomCleanProcedure:['Dọn riêng']},[false]);
assert.deepEqual(custom.prepProcedure,['Chuẩn bị riêng']);assert.deepEqual(custom.cleanProcedure,['Dọn riêng']);
assert.equal(custom.isChecklistComplete,false);
assert.equal(resolve({roomPrepProcedure:['Chuẩn bị riêng']},[true]).isChecklistComplete,true);
console.log('PASS empty/missing room procedures show defaults; completing real checklist unlocks setup; custom procedures remain');
