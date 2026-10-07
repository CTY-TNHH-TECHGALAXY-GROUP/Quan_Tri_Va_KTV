const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
require('ts-node').register({project:path.join(__dirname,'qa/tsconfig.qa.json'),transpileOnly:true});
require('tsconfig-paths').register({baseUrl:path.resolve(__dirname,'..'),paths:{'@/*':['./*']}});
const React=require('react');
const {dispatchFormSignature,mergeSavedDispatchForm,dispatchFormMissingInfo}=require('../lib/dispatch-form-draft');
const filename=path.join(__dirname,'../app/reception/dispatch/_components/QuickDispatchTable.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8')+'\nexport {ServiceGroupCard};',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {QuickDispatchTable,ServiceGroupCard}=mod.exports;
const live=seg=>seg.voided!==true && seg.voided!=='true';
const a={id:'a',ktvId:'A',sequenceSlot:1,roomId:'R',bedId:'X',startTime:'10:00',endTime:'10:30',duration:30};
const b={...a,id:'b',ktvId:'B',sequenceSlot:2,startTime:'10:30',endTime:'11:00'};
const staff=seg=>({id:'row-'+seg.ktvId,ktvId:seg.ktvId,ktvName:seg.ktvId,segments:[seg],noteForKtv:'',serviceNameForKtv:''});
const item={id:'item',serviceId:'test',serviceName:'Body',duration:60,status:'NEW',options:{dispatchRevision:0},staffList:[]};
assert.match(dispatchFormMissingInfo([{...item,duration:0}])[0],/Chưa xác định thời lượng dịch vụ/);

// Drive the actual table's state/effect cycle, including parent updates and save responses.
function mount(initial) {
  const originals=Object.fromEntries(['useState','useRef','useMemo','useEffect'].map(key=>[key,React[key]]));
  const cells=[];let cursor=0,dirty=true,effects=[],card,services=[structuredClone(initial)],saved=[],cacheWrites=0;
  const changed=(before,after)=>!before || !after || before.length!==after.length || before.some((value,index)=>value!==after[index]);
  const hook=(make)=>{const index=cursor++;return cells[index] || (cells[index]=make(index));};
  React.useState=initial=>{const cell=hook(index=>({value:typeof initial==='function'?initial():initial,index}));return [cell.value,next=>{
    const value=typeof next==='function'?next(cell.value):next;if(value!==cell.value){cell.value=value;dirty=true;}}];};
  React.useRef=initial=>hook(()=>({current:initial}));
  React.useMemo=(fn,deps)=>{const cell=hook(()=>({}));if(changed(cell.deps,deps)){cell.value=fn();cell.deps=deps;}return cell.value;};
  React.useEffect=(fn,deps)=>{const cell=hook(()=>({}));if(changed(cell.deps,deps)){cell.deps=deps;effects.push(fn);}};
  const find=element=>{if(!element || typeof element!=='object')return;if(element.type===ServiceGroupCard)card=element.props;
    for(const child of [element.props?.children].flat(Infinity))find(child);};
  const props={orderId:'booking',rooms:[{id:'R',name:'R'}],beds:[{id:'X',roomId:'R'}],availableTurns:[],staffs:[],busyBedIds:[],onPrintGroup(){},
    onUpdateServices(next){services=next;dirty=true;cacheWrites++;},
    async onSaveStaffRow(submitted){saved.push(structuredClone(submitted));const segments=submitted.staffList.flatMap(row=>row.segments.map(seg=>({...seg,ktvId:row.ktvId})));
      const stored={status:submitted.status,roomName:'R',bedId:'X',segments,options:{...submitted.options,dispatchRevision:(submitted.options.dispatchRevision || 0)+1}};
      services=services.map(current=>mergeSavedDispatchForm(current,submitted,stored));dirty=true;return true;}};
  const quiet=console.log;console.log=()=>{};
  function settle(){for(let n=0;dirty;n++){assert.ok(n<20,'form effects must settle');dirty=false;cursor=0;effects=[];
    find(QuickDispatchTable({...props,services}));for(const effect of effects)effect();}return card;}
  const api={get card(){return settle();},get item(){settle();return services[0];},get saves(){return saved;},get cacheWrites(){return cacheWrites;},
    update(patch){settle().onUpdate(patch);return settle();},replaceServer(next){services=[next];dirty=true;return settle();},
    async save(idx=0){await settle().onSaveRow(idx,true);return settle();},close(){Object.assign(React,originals);console.log=quiet;}};
  settle();return api;
}
(async()=>{
  let form=mount(item);
  try{
    form.update({selectedKtvIds:['A'],selectedRoomIds:['R'],ktvBedIds:['X'],ktvStartTimes:['10:00'],ktvEndTimes:['10:30'],ktvDurations:[30]});
    form.update({confirmedSequential:true,workMode:'sequential'});
    form.update({selectedKtvIds:['A','B'],selectedRoomIds:['R','R'],ktvBedIds:['X','X'],ktvStartTimes:['10:00','10:30'],ktvEndTimes:['10:30','11:00'],ktvDurations:[30,30]});
    assert.equal(form.saves.length,0,'editing must only update cache');assert.ok(form.cacheWrites>=3);
    assert.deepEqual(form.card.state.selectedKtvIds,['A','B']);await form.save(1);assert.equal(form.saves.length,1);
    assert.deepEqual(form.card.state.selectedKtvIds,['A','B']);
    form.update({selectedKtvIds:['A'],ktvStartTimes:['10:00'],ktvEndTimes:['10:30'],ktvDurations:[30]});await form.save();
    form.update({selectedKtvIds:['A','C'],selectedRoomIds:['R','R'],ktvBedIds:['X','X'],ktvStartTimes:['10:00','10:30'],ktvEndTimes:['10:30','11:15'],ktvDurations:[30,45]});
    assert.deepEqual(form.card.state.selectedKtvIds,['A','C'],'Save A must not require refresh to select B');
  }finally{form.close();}
  const running={...item,status:'IN_PROGRESS',options:{sequentialSlots:2,dispatchRevision:7,serviceNamesForKtvs:{B:'B đã lưu'}},
    staffList:[staff({...a,actualStartTime:'2026-09-26T03:00:00Z'}),staff({...b,voided:true}),staff({...b,id:'c',ktvId:'C'})]};
  form=mount(running);
  try{
    assert.deepEqual(form.card.state.selectedKtvIds,['A','C'],'historical B must not be an editable third row');
    form.update({selectedKtvIds:['A','B'],ktvServiceNames:['Tên A','B mới'],ktvDurations:[30,45],ktvEndTimes:['10:30','11:15']});
    const currentB=form.item.staffList.find(row=>row.ktvId==='B' && row.segments.some(live));
    assert.ok(currentB);assert.equal(currentB.segments[0].voided,undefined,'returning B must get a new active segment');
    assert.notEqual(currentB.segments[0].id,b.id);assert.equal(currentB.serviceNameForKtv,'B mới');
    assert.deepEqual(form.item.staffList.find(row=>row.ktvId==='A').segments,running.staffList[0].segments);
    await form.save(1);assert.deepEqual(form.card.state.selectedKtvIds,['A','B']);
    form.update({ktvServiceNames:['Tên A','B sửa lần 2'],ktvDurations:[30,50],ktvEndTimes:['10:30','11:20']});await form.save(1);
    assert.equal(form.card.state.ktvDurations[1],50);assert.equal(form.card.state.ktvServiceNames[1],'B sửa lần 2');
    assert.equal(form.saves.length,2);assert.equal(form.saves[1].options.dispatchRevision,8);
  }finally{form.close();}
  const runningOnly={...item,status:'IN_PROGRESS',options:{sequentialSlots:2,dispatchRevision:3},
    staffList:[staff({...a,actualStartTime:'2026-09-26T03:00:00Z'})]};
  form=mount(runningOnly);
  try{
    form.update({ktvDurations:[47],ktvEndTimes:['10:47']});
    assert.equal(form.saves.length,0,'duration edit remains local until Save or Dispatch');
    assert.equal(form.item.staffList[0].segments[0].duration,47);
    assert.equal(form.item.staffList[0].segments[0].actualStartTime,'2026-09-26T03:00:00Z');
    await form.save();assert.equal(form.saves[0].staffList[0].segments[0].duration,47);
  }finally{form.close();}
  const submitted={...running,staffList:[staff(a),staff(b)]};
  const typing=structuredClone(submitted);typing.staffList[1].serviceNameForKtv='Đang gõ tiếp';
  const stored={status:'IN_PROGRESS',segments:[a,{...b,id:'server-b'}],options:{sequentialSlots:2,dispatchRevision:9,serviceNamesForKtvs:{B:'Tên vừa Save'}}};
  const merged=mergeSavedDispatchForm(typing,submitted,stored);
  assert.equal(merged.staffList[1].serviceNameForKtv,'Đang gõ tiếp');assert.equal(merged.options.dispatchRevision,9);
  const clean=mergeSavedDispatchForm(submitted,submitted,stored);
  assert.equal(clean.staffList[1].segments[0].id,'server-b');assert.equal(clean.staffList[1].serviceNameForKtv,'Tên vừa Save');
  assert.notEqual(dispatchFormSignature(merged),dispatchFormSignature(submitted));
  const page=fs.readFileSync(path.join(__dirname,'../app/reception/dispatch/page.tsx'),'utf8');
  const callback=page.slice(page.indexOf('onSaveStaffRow={async ')+16,page.indexOf('                    onPrintGroup=',page.indexOf('onSaveStaffRow={async '))).trim().replace(/}\}$/, '}').replace("await import('./actions')",'actions');
  const uiItem=structuredClone(submitted);uiItem.options={sequentialSlots:2,dispatchRevision:4};
  const beforeDraft=structuredClone(uiItem.staffList);const attempts=[];
  const drafts={current:new Map([['booking/item',uiItem]])};const dirty={current:new Set(['booking/item/A','booking/item/B'])};
  let confirmOverlap=false,cacheWrites=0;
  const dispatchPendingRef={current:false};
  const deps={actions:{saveDispatchForm:async(...args)=>{attempts.push(args);return args[6]
      ? {success:true,revisions:{item:6},savedItem:{...stored,options:{...stored.options,dispatchRevision:6}}}
      : {success:false,code:'OVERLAP_CONFIRM_REQUIRED',revisions:{item:5},savedItem:{...stored,options:{...stored.options,dispatchRevision:5}}};}},
    selectedSubOrder:{bookingId:'booking'},draftItemsRef:drafts,dispatchFormSignature,mergeSavedDispatchForm,
    dispatchPendingRef,setDispatchBusy:pending=>{dispatchPendingRef.current=pending;},
    confirmUpdatedBOverlap:()=>confirmOverlap,persistDraftCache:()=>{cacheWrites++;},
    clearDirtyItem:()=>{drafts.current.clear();dirty.current.clear();},updateOrder:(_id,update)=>{Object.assign(uiItem,update({services:[uiItem]}).services[0]);},
    alert:message=>{throw new Error(message);}};
  const uiSave=new Function(...Object.keys(deps),ts.transpileModule('return '+callback+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps));
  assert.equal(await uiSave(uiItem,'B',true,true),false);
  assert.deepEqual(uiItem.staffList,beforeDraft);assert.equal(uiItem.options.dispatchRevision,5);assert.equal(dirty.current.size,2);assert.equal(drafts.current.size,1);
  assert.ok(cacheWrites);confirmOverlap=true;
  assert.equal(await uiSave(uiItem,'B',true,true),true);
  assert.deepEqual(attempts.map(args=>args[3]),[4,5,5]);assert.equal(drafts.current.size,0);assert.equal(dirty.current.size,0);
  const cacheSource=page.slice(page.indexOf('  const draftItemsRef ='),page.indexOf('  const confirmLeaveDraft ='));
  const storage=new Map();const sessionStorage={setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)};
  const useRef=value=>({current:value}),useState=value=>[value,()=>{}];
  const cache=new Function('useRef','useState','sessionStorage','setStaleDrafts',ts.transpileModule(cacheSource+'return {draftItemsRef,draftCacheKeyRef,dirtyRowsRef,updateDirtyRows,clearDirtyItem};',
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(useRef,useState,sessionStorage,()=>{});
  cache.draftCacheKeyRef.current='dispatch-drafts:admin:2026-09-26';cache.draftItemsRef.current.set('booking/item',submitted);
  cache.updateDirtyRows(new Set(['booking/item/A']));assert.equal(JSON.parse(storage.values().next().value).items[0][1].id,'item');
  const restoreStart=page.indexOf('  useEffect(() => {\n    const key=`dispatch-drafts:');
  const restoreSource=page.slice(restoreStart,page.indexOf('  useEffect(() => {',restoreStart+3));
  cache.draftItemsRef.current.clear();cache.dirtyRowsRef.current.clear();
  new Function('useEffect','user','selectedDate','sessionStorage','draftCacheKeyRef','draftItemsRef','dirtyRowsRef','setUnsavedCount','updateDirtyRows',
    ts.transpileModule(restoreSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(fn=>fn(),{id:'admin'},'2026-09-26',sessionStorage,
      cache.draftCacheKeyRef,cache.draftItemsRef,cache.dirtyRowsRef,()=>{},cache.updateDirtyRows);
  assert.equal(cache.draftItemsRef.current.get('booking/item').id,'item');assert.equal(cache.dirtyRowsRef.current.size,1);
  cache.clearDirtyItem('booking','item');assert.equal(storage.size,0);
  console.log('PASS page callback: overlap cancel keeps draft/cache/revision, confirmed retry clears cache; session cache restores per user/date');
  console.log('PASS mounted form: cache only, A/B before Save, add after Save without refresh, B→C→B, own duration/name and late-response protection');
})().catch(error=>{console.error(error);process.exitCode=1;});
