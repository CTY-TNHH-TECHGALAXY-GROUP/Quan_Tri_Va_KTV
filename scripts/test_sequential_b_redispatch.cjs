const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const ts=require('typescript');
require('ts-node').register({project:join(__dirname,'qa/tsconfig.qa.json'),transpileOnly:true});
require('tsconfig-paths').register({baseUrl:join(__dirname,'..'),paths:{'@/*':['./*']}});
const {isTwoSlotSequential}=require('../lib/dispatch-status');
const {liveDispatchConflict,savedPlanFields}=require('../lib/dispatch-live-guard');
const source=readFileSync(join(__dirname,'../app/reception/dispatch/actions.ts'),'utf8');
const applyBody=source.slice(source.indexOf('async function applyDispatchEdit('),source.indexOf('async function resolveGuestIdsForUpdate('));
const processBody=source.slice(source.indexOf('export async function processDispatch('),source.indexOf('/** Manual actual-time corrections'));
const compiled=ts.transpileModule(applyBody+processBody,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const original={id:'item',bookingId:'booking',status:'PREPARING',options:{sequentialSlots:2,dispatchRevision:4,serviceNamesForKtvs:{A:'Tên A',B:'Tên B cũ'}},technicianCodes:['A','B'],segments:[
  {id:'a',ktvId:'A',sequenceSlot:1,roomId:'R',bedId:'X',startTime:'10:00',endTime:'10:30',duration:30},
  {id:'b',ktvId:'B',sequenceSlot:2,roomId:'R',bedId:'X',startTime:'10:30',endTime:'11:00',duration:30,plannedStartAt:'2026-09-26T03:30:00Z'}]};
let current,notifications,rpcs,staffQueries,rpcResult,notifySucceeded=true;
const db={from(table){return {select(){return this;},eq(){return this;},in(_field,ids){if(table==='Staff')staffQueries.push(ids);return this;},delete(){assert.equal(table,'StaffNotifications');return this;},single(){return Promise.resolve({data:{status:current.status}});},then(resolve,reject){
  const data=table==='BookingItems'?[structuredClone(current)]:table==='Staff'?[{id:'B',full_name:'B',work_type:'TYPE_A'}]:table==='TurnQueue'?[{employee_id:'B',status:'assigned'}]:[];
  return Promise.resolve({data}).then(resolve,reject);
}};},async rpc(name,args){rpcs.push({name,args});return rpcResult;}};
const dependencies={requirePermission:async p=>assert.equal(p,'dispatch_board'),getSupabaseAdmin:()=>db,
  currentCounterActor:async()=>({id:'ADMIN',name:'Quầy test',verified:true}),resolveNewExternalKtvIds:async()=>null,
  isTwoSlotSequential,liveDispatchConflict,savedPlanFields,checkedInStaffIds:async()=>new Set(['B']),
  findKtvsNeedingCheckinConfirm:({ktvIds})=>{assert.deepEqual(ktvIds,['B']);return [];},
  resolveGuestIdsForUpdate:async()=>({updatesToApply:[],newGuests:[]}),
  createNotification:async notification=>{notifications.push(notification);return notifySucceeded;}};
const exportsStub={};
new Function(...Object.keys(dependencies),'exports',compiled)(...Object.values(dependencies),exportsStub);
function reset(){current=structuredClone(original);notifications=[];rpcs=[];staffQueries=[];rpcResult={data:{success:true},error:null};}
const payload=()=>{const update=structuredClone(current);update.options.serviceNamesForKtvs.B='Tên B mới';return {status:current.status,date:'2026-09-26',itemUpdates:[update],staffAssignments:current.segments.map(s=>({ktvId:s.ktvId,bookingItemId:'item',segmentId:s.id,startTime:s.startTime,endTime:s.endTime}))};};
async function main(){
  reset(); let input=payload();input.itemUpdates[0].segments[1].startTime='10:45';input.itemUpdates[0].segments[1].endTime='11:15';
  assert.equal((await exportsStub.processDispatch('booking',input)).success,true);
  assert.deepEqual(staffQueries,[['B']]);assert.equal(rpcs[0].name,'dispatch_apply_edit');assert.equal(rpcs[0].args.p_action,'DISPATCH');
  assert.equal(rpcs[0].args.p_payload.itemUpdates[0].options.dispatchRevision,4);
  assert.equal(rpcs[0].args.p_payload.itemUpdates[0].segments[1].startTime,'10:45');
  assert.equal(notifications.length,1);assert.equal(notifications[0].employeeId,'B');
  assert.ok(notifications[0].message.includes('Tên B mới')&&notifications[0].message.includes('10:45'));
  assert.deepEqual(current,original);
  console.log('PASS REDISPATCH 1/5: Tên/giờ B trong payload; chỉ thông báo B, không tạo tua/gửi A');
  reset();rpcResult={error:{message:'OVERLAP_CONFIRM_REQUIRED',details:JSON.stringify({success:false,code:'OVERLAP_CONFIRM_REQUIRED',referenceAt:'2026-09-26T03:30:00Z',referenceKind:'planned'})}};
  assert.equal((await exportsStub.processDispatch('booking',payload())).code,'OVERLAP_CONFIRM_REQUIRED');assert.equal(notifications.length,0);
  rpcResult={data:{success:true},error:null};input=payload();input.confirmOverlap=true;
  assert.equal((await exportsStub.processDispatch('booking',input)).success,true);assert.equal(rpcs.at(-1).args.p_payload.confirmOverlap,true);
  console.log('PASS REDISPATCH 2/5: SQL overlap chuyển thành yêu cầu xác nhận; chỉ gửi sau xác nhận');
  reset();rpcResult={error:{message:'Dịch vụ đã có bản lưu mới'}};
  assert.equal((await exportsStub.processDispatch('booking',payload())).success,false);assert.equal(notifications.length,0);
  console.log('PASS REDISPATCH 3/5: RPC từ chối phiên bản cũ thì không gửi thông báo thành công');
  reset();current.status='IN_PROGRESS';current.segments[1].actualStartTime='2026-09-26T03:30:00Z';input=payload();
  input.itemUpdates[0].segments[1].startTime='10:45';input.itemUpdates[0].segments[1].endTime='11:15';
  assert.equal((await exportsStub.processDispatch('booking',input)).success,false);assert.equal(rpcs.length,0);assert.equal(notifications.length,0);
  console.log('PASS REDISPATCH 4/5: B đã bắt đầu bị chặn sửa giờ trước RPC');
  reset();current.status='IN_PROGRESS';current.segments[1].actualStartTime='2026-09-26T03:30:00Z';
  assert.equal((await exportsStub.processDispatch('booking',payload())).success,true);
  assert.equal(notifications.length,1);assert.equal(notifications[0].employeeId,'B');
  assert.equal(rpcs[0].args.p_payload.itemUpdates[0].segments[1].actualStartTime,current.segments[1].actualStartTime);
  console.log('PASS REDISPATCH 5/5: B đang làm vẫn nhận tên mới; giờ thực không bị xóa/reset');
  reset();notifySucceeded=false;
  const savedWithWarning=await exportsStub.processDispatch('booking',payload());
  assert.equal(savedWithWarning.success,true);assert.equal(savedWithWarning.warnings.length,1);
  assert.ok(savedWithWarning.warnings[0].includes('Đã lưu'));
  assert.equal(notifications.length,1);assert.equal(notifications[0].employeeId,'B');
  notifySucceeded=true;
  console.log('PASS notification failure: DISPATCH saved successfully with B-only warning');
  const page=readFileSync(join(__dirname,'../app/reception/dispatch/page.tsx'),'utf8');
  const retryBody=page.slice(page.indexOf('          let res: any = await sendPayload();'),page.indexOf('          if (!res.success) {',page.indexOf('          let res: any = await sendPayload();')));
  const retryCode=ts.transpileModule(retryBody,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const runRetry=new Function('sendPayload','askCheckinConfirm','confirmUpdatedBOverlap',`return (async()=>{const confirmedOverlapItemIds=[];const payload={itemUpdates:[{id:'one'},{id:'two'}]};const confirmedUncheckedKtvIds=[];${retryCode}return {res,confirmedOverlapItemIds,confirmedUncheckedKtvIds};})()`);
  let calls=0;
  const results=[{success:false,code:'NEED_CHECKIN_CONFIRM',ktvs:[{id:'B'}]},
    {success:false,code:'OVERLAP_CONFIRM_REQUIRED',itemId:'one'},
    {success:false,code:'OVERLAP_CONFIRM_REQUIRED',itemId:'two'},{success:true}];
  const retry=await runRetry(async()=>results[calls++],async()=>true,()=>true);
  assert.equal(calls,4);assert.equal(retry.res.success,true);assert.deepEqual(retry.confirmedOverlapItemIds,['one','two']);assert.deepEqual(retry.confirmedUncheckedKtvIds,['B']);
  await assert.rejects(runRetry(async()=>({code:'OVERLAP_CONFIRM_REQUIRED',itemId:'unknown'}),async()=>true,()=>true),/Không xác định/);
  let repeats=0;
  await assert.rejects(runRetry(async()=>{repeats++;return {code:'OVERLAP_CONFIRM_REQUIRED',itemId:'one'};},async()=>true,()=>true),/Không xác định/);
  assert.equal(repeats,2);
  // Run the actual per-payload loop: a confirmation from child one must not reach child two.
  const loop=page.slice(page.indexOf('      for (const payload of dispatchPayloads) {'),page.indexOf('      if (!isPartial || targetSvcIds.length',page.indexOf('      for (const payload of dispatchPayloads) {')));
  const loopCode=ts.transpileModule(loop,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const sent=[],asked=[];
  const runLoop=new Function('dispatchPayloads','processDispatch','confirmUpdatedBOverlap',`return (async()=>{const confirmedUncheckedKtvIds=[];const bookingStatus='PREPARING',selectedDate='2026-09-26',isPartial=false,finalNotesToSave='';const askCheckinConfirm=async()=>true;const alert=()=>{};${loopCode}})()`);
  await runLoop(['one','two'].map(id=>({bookingId:id,dbBookingId:id,itemUpdates:[{id}]})),async(id,payload)=>{
    sent.push([id,[...payload.confirmedOverlapItemIds]]);
    return payload.confirmedOverlapItemIds.includes(id)?{success:true}:{success:false,code:'OVERLAP_CONFIRM_REQUIRED',itemId:id};
  },res=>{asked.push(res.itemId);return true;});
  assert.deepEqual(sent,[['one',[]],['one',['one']],['two',[]],['two',['two']]]);assert.deepEqual(asked,['one','two']);
  console.log('PASS retry UI: checkin + từng overlap; reset theo đơn con; chặn item lạ/xác nhận lặp');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
