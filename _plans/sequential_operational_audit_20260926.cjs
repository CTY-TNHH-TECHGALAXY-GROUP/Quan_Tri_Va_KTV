// The original defect reproductions are documented in the adjacent audit report.
// This entry point now runs regression assertions for the corrected behavior.
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
for(const test of ['test_sequential_live_segments.cjs','test_sequential_finish_persistence.cjs',
 'test_sequential_employee_consistency.cjs','test_sequential_midnight_metadata.cjs',
 'test_sequential_notifications.cjs','test_sequential_inline_ui.cjs','test_sequential_sql.cjs']) {
 const result=spawnSync(process.execPath,[resolve(root,'scripts',test)],{cwd:root,stdio:'inherit'});
 if(result.status!==0){process.exit(result.status||1);}
}
console.log('PASS all six operational regression groups');
