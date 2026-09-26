const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const ts=require('typescript');
require('ts-node').register({project:join(__dirname,'qa/tsconfig.qa.json'),transpileOnly:true});
require('tsconfig-paths').register({baseUrl:join(__dirname,'..'),paths:{'@/*':['./*']}});
const {isTwoSlotSequential}=require('../lib/dispatch-status');
const {dispatchRevision}=require('../lib/dispatch-edit-history');
const {parseKtvOptions}=require('../lib/ktvUtils');
const source=readFileSync(join(__dirname,'../app/reception/dispatch/page.tsx'),'utf8');
const body=source.slice(source.indexOf('  const confirmLiveHandoff = async () => {'),source.indexOf('  const addStaffRow = async'));
const compiled=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run({overlap=false,start='2026-09-27T00:10',failure=false}={}) {
 const calls=[],alerts=[];let refreshed=0,state;
 const liveHandoff={bookingId:'booking',itemId:'item',fromKtvId:'A',toKtvId:'B',plannedStartAt:start,durationMinutes:20,expectedRevision:7,saving:false};state=liveHandoff;
 const deps={liveHandoff,orders:[{id:'booking',services:[{id:'item',options:{sequentialSlots:2,dispatchRevision:7,serviceNamesForKtvs:{A:'Tên A gốc',B:'Tên B gốc'}},staffList:[
  {ktvId:'A',serviceNameForKtv:'Tên A giữ nguyên',noteForKtv:'Ghi chú A'},
  {ktvId:'B',serviceNameForKtv:'Tên B chưa lưu',noteForKtv:'Ghi chú B chưa lưu'}]}]}],
  isTwoSlotSequential,dispatchRevision,parseKtvOptions,
  setLiveHandoff:update=>{state=typeof update==='function'?update(state):update;},
  enableSequentialItem:async()=>{throw Error('Không bật nối tiếp lại');},
  handoffSequentialKtv:async payload=>{calls.push(structuredClone(payload));return failure?{success:false,error:'Bản cũ'}:overlap&&calls.length===1?{success:false,code:'OVERLAP_CONFIRM_REQUIRED',referenceAt:'2026-09-26T17:20:00Z',referenceKind:'planned'}:{success:true};},
  alert:text=>alerts.push(text),confirm:()=>true,fetchData:async()=>refreshed++};
 await new Function(...Object.keys(deps),compiled+'return confirmLiveHandoff;')(...Object.values(deps))();
 return {calls,alerts,refreshed,state};
}
(async()=>{
 for(const overlap of [false,true]) {
  const result=await run({overlap});assert.equal(result.refreshed,1);assert.equal(result.state,null);
  assert.equal(result.calls.length,overlap?2:1);
  for(const input of result.calls){assert.equal(input.plannedStartAt,'2026-09-26T17:10:00.000Z');assert.equal(input.expectedRevision,7);
   assert.deepEqual(input.metadata,{serviceNamesForKtvs:{A:'Tên A giữ nguyên',B:'Tên B chưa lưu'},notesForKtvs:{A:'Ghi chú A',B:'Ghi chú B chưa lưu'}});}
  if(overlap)assert.equal(result.calls[1].confirmOverlap,true);
 }
 const bad=await run({start:'invalid'});assert.equal(bad.calls.length,0);assert.equal(bad.refreshed,0);assert.equal(bad.state.saving,false);
 const stale=await run({failure:true});assert.equal(stale.refreshed,0);assert.equal(stale.state.saving,false);assert.ok(stale.alerts[0].includes('Bản cũ'));
 console.log('PASS MIDNIGHT METADATA: actual modal submits next-day ISO with pending own names/notes, overlap retry preserved, invalid/stale stay editable');
})().catch(error=>{console.error(error);process.exitCode=1;});
