const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
require('ts-node').register({project:path.join(root,'scripts/qa/tsconfig.qa.json'),transpileOnly:true});
require('tsconfig-paths').register({baseUrl:root,paths:{'@/*':['./*']}});
const {handleReleaseKTV}=require('../../app/api/ktv/booking/_handlers/handleReleaseKTV');
(async()=>{
 let calls=0;
 const context={bookingId:'booking',technicianCode:'A',today:'2026-09-29',body:{photosBase64:[]},supabase:{
  async rpc(name,args){calls++;assert.equal(name,'ktv_release_work_root_atomic');assert.equal(args.p_employee_id,'A');return {data:null,error:{message:'injected failure'}}}
 }};
 await assert.rejects(handleReleaseKTV(context),/Chưa xác nhận được bàn giao/);
 assert.equal(calls,1);
 await assert.rejects(handleReleaseKTV({...context,body:{photosBase64:['invalid']}}),/Ảnh bàn giao không hợp lệ/);
 assert.equal(calls,1);
 await handleReleaseKTV({...context,supabase:{async rpc(){return {data:{success:true},error:null}}}});
 console.log('PASS release handler: database failure is surfaced; invalid proof blocked; success acknowledged');
})().catch(e=>{console.error(e);process.exitCode=1});
