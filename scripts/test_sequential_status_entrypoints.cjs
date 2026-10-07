const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({project:path.join(__dirname,'qa/tsconfig.qa.json'),transpileOnly:true});
const statuses = require('../lib/dispatch-status');
const {parseKtvSegments,ktvMatchesSeg} = require('../lib/ktvUtils');
const source = fs.readFileSync(path.join(__dirname,'../app/reception/dispatch/actions.ts'),'utf8');
const item = {id:'item',status:'PAUSED',options:{sequentialSlots:2},segments:[{id:'a',ktvId:'A',sequenceSlot:1,actualStartTime:'2026-09-26T03:00:00Z',duration:30}]};
async function check(name,status,failRead=false,fixture=item,customStartTime) {
  let writes=0;
  const db={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},
    update(){writes++;throw Error('must reject before any mutation');},
    single(){return Promise.resolve({data:{status:'IN_PROGRESS'},error:null});},
    then(resolve,reject){return Promise.resolve(failRead?{data:null,error:Error('DB read failed')}:{data:[fixture],error:null}).then(resolve,reject);}};return q;}};
  const start=source.indexOf('export async function '+name+'(');
  const end=source.indexOf('\nexport async function ',start+10);
  const code=ts.transpileModule(source.slice(start,end<0?undefined:end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const out={};
  new Function('exports','requirePermission','getSupabaseAdmin','require','parseKtvSegments','ktvMatchesSeg',code)(out,async()=>{},()=>db,id=>{assert.equal(id,'@/lib/dispatch-status');return statuses;},parseKtvSegments,ktvMatchesSeg);
  const result=await (name==='updateBookingStatus'?out[name]('booking',status,'2026-09-26'):out[name](['item'],status,'2026-09-26','booking',['A'],false,customStartTime));
  assert.equal(result.success,false);assert.match(result.error,failRead?/DB read failed/:/Ca nối tiếp|Không thể chuyển trạng thái|Giờ bắt đầu không hợp lệ/);assert.equal(writes,0);
}
async function startOnlyA() {
  const current={...item,status:'PREPARING',segments:[{id:'a',ktvId:'A',duration:30},{id:'b',ktvId:'B',duration:30}]};
  const beforeB=structuredClone(current.segments[1]);const queueWrites=[];let assignedIncluded=false;
  const db={from(table){let patch,ids;const q={select(){return q;},eq(key,value){if(key==='id')ids=[value];return q;},
    is(){return q;},overlaps(){return q;},in(key,values){if(table==='TurnQueue'&&key==='status')assignedIncluded=values.includes('assigned');if(key==='employee_id')ids=values;return q;},
    update(value){patch=value;return q;},then(resolve,reject){
      if(patch&&table==='BookingItems'){Object.assign(current,patch);if(typeof current.segments==='string')current.segments=JSON.parse(current.segments);}
      if(patch&&table==='TurnQueue')queueWrites.push({ids,patch});
      const data=patch?null:table==='TurnQueue'? [{id:'turn-A',employee_id:'A',start_time:'10:00',estimated_end_time:'10:30'}]:table==='BookingItems'?[structuredClone(current)]:{status:'PREPARING'};
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }};return q;}};
  const start=source.indexOf('export async function updateBookingItemStatus('),end=source.indexOf('\nexport async function ',start+10);
  const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,out={};
  new Function('exports','requirePermission','getSupabaseAdmin','require','parseKtvSegments','ktvMatchesSeg','isUtilityService','recalculateEstimatedEndTime',code)(out,async()=>{},()=>db,id=>{
    if(id==='@/lib/dispatch-status')return statuses;
    if(id==='@/lib/turn-sync')return {syncTurnsForDate:async()=>{}};
    throw Error(id);
  },parseKtvSegments,ktvMatchesSeg,()=>false,require('../lib/time-helper').recalculateEstimatedEndTime);
  const result=await out.updateBookingItemStatus(['item'],'IN_PROGRESS','2026-09-26','booking',['A'],false,'2026-09-26T03:05:00Z');
  assert.equal(result.success,true);assert.deepEqual(current.segments[1],beforeB);
  assert.equal(current.segments[0].actualStartTime,'2026-09-26T03:05:00Z');
  assert.equal(assignedIncluded,true);assert.equal(queueWrites.length,1);assert.deepEqual(queueWrites[0].ids,['turn-A']);
  assert.equal(queueWrites[0].patch.status,'working');assert.equal(queueWrites[0].patch.estimated_end_time,'10:35:00');
}
(async()=>{
  for(const name of ['updateBookingStatus','updateBookingItemStatus']) {
    for(const status of ['CANCELLED','PAUSED','IN_PROGRESS']) await check(name,status);
    await check(name,'IN_PROGRESS',true);
  }
  for(const segment of [{id:'a',ktvId:'A',voided:true},{id:'a',ktvId:'A',actualStartTime:'2026-09-26T03:00:00Z'},
    {id:'a',ktvId:'A',actualStartTime:'2026-09-26T03:00:00Z',actualEndTime:'2026-09-26T03:30:00Z'}]) {
    await check('updateBookingItemStatus','IN_PROGRESS',false,{...item,status:'PREPARING',segments:[segment]});
  }
  await check('updateBookingItemStatus','IN_PROGRESS',false,{...item,status:'PREPARING',segments:[{id:'a',ktvId:'A'}]},'invalid');
  await startOnlyA();
  console.log('PASS legacy full/partial status routes cannot bypass sequential cancellation scope or resume/start both clocks; failed reads cause no writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
