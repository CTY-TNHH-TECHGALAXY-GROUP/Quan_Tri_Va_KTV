// Audit assertions confirm defects in bc06814f; they are not fixed-behavior tests.
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
for(const test of ['audit_sequential_lifecycle_second.cjs','audit_sequential_employee_second.cjs',
 'audit_sequential_admin_metadata.cjs','audit_sequential_dispatch_second.cjs','audit_sequential_sql_second.cjs']){
 const result=spawnSync(process.execPath,[resolve(root,'scripts',test)],{cwd:root,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
console.log('CONFIRMED all second-audit reproductions; runtime source unchanged');
