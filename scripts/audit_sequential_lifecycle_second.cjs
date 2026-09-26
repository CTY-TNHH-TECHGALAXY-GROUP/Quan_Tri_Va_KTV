// Read-only audit: confirms current defects using the actual handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
require('ts-node').register({ project: path.join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: path.join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const { handleStartTimer } = require('../app/api/ktv/booking/_handlers/handleStartTimer');
const proof = 'data:image/jpeg;base64,/9j/';
async function startScenario(failure = '', initialStart) {
 const rows = ['one','two'].map((id,i) => ({ id, status:'PREPARING', options:{}, segments:[{ id:id+'-seg', ktvId:'A', roomId:'R'+i, bedId:'X', startTime:'10:00', duration:30, ...(i===0&&initialStart?{actualStartTime:initialStart}:{}) }] }));
 const writes=[];
 const db={from(table){let payload,fields='',itemId;const q={select(value){fields=value||'';return q;},eq(key,value){if(key==='id')itemId=value;return q;},in(){return q;},update(value){payload=value;return q;},single(){return Promise.resolve({data:{timeStart:'2026-09-26T03:00:00Z',status:'IN_PROGRESS'}});},then(resolve,reject){
  if(payload){writes.push({table,itemId,payload});const error=table==='TurnQueue'||(itemId==='two'&&failure==='second')?{message:'injected failure'}:null;
   if(!error&&table==='BookingItems')Object.assign(rows.find(row=>row.id===itemId),{...payload,segments:JSON.parse(payload.segments)});
   return Promise.resolve({data:null,error}).then(resolve,reject);}
  return Promise.resolve({data:table==='BookingItems'?structuredClone(rows):[]}).then(resolve,reject);
 }};return q;},storage:{from(){return {async upload(p){return {data:{path:p}};},getPublicUrl(p){return {data:{publicUrl:'https://local.test/'+p}};},async remove(){return {error:null};}};}}};
 const result=await handleStartTimer({supabase:db,bookingId:'booking',technicianCode:'A',action:'START_TIMER',turnForSync:{id:'turn'},allItemIdsForThisKTV:['one','two'],body:{activeSegmentIndex:0,shouldMerge:false,startPhotoBase64:proof,guestSlipperPhotoBase64:proof}});
 return {rows,writes,result};
}
async function main(){
 const started=await startScenario();
 assert.equal(started.result.earlyResponse,undefined);
 assert.equal(started.rows[1].status,'IN_PROGRESS');assert.equal(started.rows[1].segments[0].actualStartTime,undefined);
 console.log('CONFIRMED START: unstarted second service marked IN_PROGRESS; TurnQueue update error ignored');
 const partial=await startScenario('second');
 assert.equal(partial.result.earlyResponse.status,500);assert.ok(partial.rows[0].segments[0].actualStartTime);assert.equal(partial.rows[1].segments[0].actualStartTime,undefined);
 console.log('CONFIRMED START: second write failure leaves first started, without transaction');
 const repeated=await startScenario('', '2026-09-26T03:00:00Z');
 assert.notEqual(repeated.rows[0].segments[0].actualStartTime,'2026-09-26T03:00:00Z');
 console.log('CONFIRMED START: duplicate START overwrites actual start on ordinary A service');
 const filename=path.join(__dirname,'test_sequential_finish_persistence.cjs');
 const source=fs.readFileSync(filename,'utf8');
 const audit=source.slice(0,source.indexOf('async function main()'))+`
async function main(){
 const a=item('one'), later=item('two');delete later.segments[0].actualStartTime;
 const state=database([a,later]);const result=await run(state);
 assert.equal(result.bookingPersisted,true);
 assert.ok(segments(state.rows[1])[0].actualStartTime);assert.ok(segments(state.rows[1])[0].actualEndTime);
 assert.equal(state.rows[1].status,'CLEANING');
 console.log('CONFIRMED FINISH: same-room unstarted later service gets manufactured actual start/end and CLEANING');
 const parent=item('parent');const child=item('child','B');child.options={mergedIntoId:'parent'};child.status='PREPARING';delete child.segments[0].actualStartTime;
 const merged=database([parent,child]);assert.equal((await run(merged,'A',['parent'])).bookingPersisted,true);
 assert.equal(merged.rows[1].status,'CLEANING');assert.equal(segments(merged.rows[1])[0].actualStartTime,undefined);
 console.log('CONFIRMED FINISH: merged child of another unstarted employee inherits CLEANING');
 const unstarted=item('unstarted');delete unstarted.segments[0].actualStartTime;
 const noWork=database([unstarted]);assert.equal((await run(noWork)).bookingPersisted,true);assert.equal(segments(noWork.rows[0])[0].actualEndTime,undefined);
 console.log('CONFIRMED FINISH: no started segment still returns successful persisted completion request (UI success opens REVIEW)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});`;
 const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(audit,filename);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
