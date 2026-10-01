import type { ServiceBlock } from '@/app/reception/dispatch/types';
import { parseKtvOptions, parseKtvSegments } from './ktvUtils';
import { isUtilityService } from './booking.logic';

/** Compare editable fields, ignoring generated row IDs and server revision/history. */
export function dispatchFormSignature(item: ServiceBlock) {
  return JSON.stringify({ sequential: Number(item.options?.sequentialSlots) === 2, displayName: item.displayName || item.options?.displayName || item.serviceName,
    serviceId:item.serviceId,duration:item.duration,selectedRoomId:item.selectedRoomId || '',bedId:item.bedId || '',
    adminNote:item.adminNote || '',customerNote:item.customerNote || '',genderReq:item.genderReq || '',strength:item.strength || '',focus:item.focus || '',avoid:item.avoid || '',
    customerGroupId:item.customerGroupId || '',mergedIntoId:item.mergedIntoId || item.options?.mergedIntoId || '',mergedServiceIds:item.mergedServiceIds || [],
    rows: item.staffList.filter(row => row.ktvId && row.segments.some((seg:any) => seg.voided !== true && seg.voided !== 'true')).map(row => ({
      ktvId:row.ktvId,name:row.serviceNameForKtv || '',note:row.noteForKtv || '',
      segments:row.segments.filter((seg:any)=>seg.voided!==true && seg.voided!=='true').map(seg=>({
        slot:seg.sequenceSlot,room:seg.roomId,bed:seg.bedId,start:seg.startTime,end:seg.endTime,duration:seg.duration })) })) });
}

/** A save response acknowledges its submitted draft; later typing stays in the form. */
export function mergeSavedDispatchForm(current: ServiceBlock, submitted: ServiceBlock, saved: any): ServiceBlock {
  const options=parseKtvOptions(saved.options);
  if (dispatchFormSignature(current)!==dispatchFormSignature(submitted)) return {...current,
    options:{...options,...current.options,dispatchRevision:options.dispatchRevision,dispatchHistory:options.dispatchHistory}};
  const segments=parseKtvSegments(saved.segments,true);
  const ids=[...new Set(segments.map(seg=>String(seg.ktvId || '')).filter(Boolean))];
  return {...current,status:saved.status,selectedRoomId:saved.roomName,bedId:saved.bedId,options,
    staffList:ids.map(ktvId=>({id:`st-${current.id}-${ktvId}`,ktvId,
      ktvName:current.staffList.find(row=>row.ktvId===ktvId)?.ktvName || submitted.staffList.find(row=>row.ktvId===ktvId)?.ktvName || ktvId,
      segments:segments.filter(seg=>seg.ktvId===ktvId),noteForKtv:options.notesForKtvs?.[ktvId] || '',
      serviceNameForKtv:options.serviceNamesForKtvs?.[ktvId] || ''}))};
}


/** Dispatch validation is shared by the editor and confirmation screen. */
export function dispatchFormMissingInfo(services: ServiceBlock[]) {
  const missing: string[]=[];
  for (const item of services) {
    if (isUtilityService(item) || item.mergedIntoId || item.options?.mergedIntoId) continue;
    if (!Number.isFinite(item.duration) || item.duration<=0) {
      missing.push(`${item.displayName || item.serviceName}: Chưa xác định thời lượng dịch vụ`);
      continue;
    }
    const rows=item.staffList.filter(row=>row.ktvId && row.segments.some(seg=>(seg as any).voided!==true && (seg as any).voided!=='true'));
    if (new Set(rows.map(row=>row.ktvId)).size < (item.min_ktv_required || 1)) missing.push(`${item.displayName || item.serviceName}: Chưa chọn đủ nhân viên`);
    for (const row of rows) for (const seg of row.segments) {
      if ((seg as any).voided===true || (seg as any).voided==='true') continue;
      const prefix=`${row.ktvName || row.ktvId}`;
      if (!seg.roomId) missing.push(`${prefix}: Chưa chọn phòng`);
      if (!seg.bedId) missing.push(`${prefix}: Chưa chọn giường`);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(seg.startTime || '')) missing.push(`${prefix}: Nhập giờ bắt đầu hợp lệ`);
      if (!Number.isInteger(Number(seg.duration)) || Number(seg.duration)<1 || Number(seg.duration)>600) missing.push(`${prefix}: Nhập thời lượng 1–600 phút`);
    }
  }
  return missing;
}

/** Actual work is authoritative while an unsaved plan keeps its original revision. */
export function mergeDispatchRealtimeDraft(draft: ServiceBlock, server: ServiceBlock): ServiceBlock {
  return {...draft,status:server.status,pauseStart:server.pauseStart,timeStart:server.timeStart,timeEnd:server.timeEnd,
    options:{...draft.options,dispatchHistory:server.options?.dispatchHistory},
    staffList:draft.staffList.map(row=>({...row,segments:row.segments.map(seg=>{
      // Khớp theo id chặng; nếu bản nháp tự sinh id khác server mà KTV chỉ có 1 chặng thì khớp theo KTV.
      const serverRow=server.staffList.find(staff=>staff.ktvId===row.ktvId);
      const actual=server.staffList.flatMap(staff=>staff.segments).find(other=>other.id===seg.id)
        || (serverRow?.segments.length===1 && row.segments.length===1 ? serverRow.segments[0] : undefined);
      if (!actual) return seg;
      return {...seg,actualStartTime:actual.actualStartTime,actualEndTime:actual.actualEndTime,
        pauses:actual.pauses,
        ...((actual as any).voided ? {voided:(actual as any).voided} : {})};
    })}))};
}
