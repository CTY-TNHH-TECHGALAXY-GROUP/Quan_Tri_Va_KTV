// Read-only audit: run the actual action against a failed RPC and observe pre-writes.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'test_sequential_b_redispatch.cjs');
let source=fs.readFileSync(filename,'utf8');
source=source.slice(0,source.indexOf('async function main()'));
source=source.replace('const db={from(table)', 'const mutations=[];const db={from(table)');
source=source.replace('delete(){assert.equal', 'update(value){mutations.push({table,value});return this;},delete(){assert.equal');
source=source.replace('resolveGuestIdsForUpdate:async()=>[]','resolveGuestIdsForUpdate:async()=>[{itemId:"item",guestId:"changed-guest"}]');
source+=`
async function main(){
 reset();rpcResult={error:{message:'Dịch vụ đã có bản lưu mới'}};
 const input=payload();input.guestCount=2;
 const result=await exportsStub.processDispatch('booking',input);
 assert.equal(result.success,false);
 assert.ok(mutations.some(m=>m.table==='Bookings'&&m.value.guestCount===2));
 assert.ok(mutations.some(m=>m.table==='BookingItems'&&m.value.guest_id==='changed-guest'));
 assert.equal(notifications.length,0);
 console.log('CONFIRMED DISPATCH: rejected stale RPC still already wrote guestCount/guest_id outside transaction');
}
main().catch(error=>{console.error(error);process.exitCode=1;});`;
const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(source,filename);
