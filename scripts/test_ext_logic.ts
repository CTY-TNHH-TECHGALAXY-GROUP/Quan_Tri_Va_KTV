import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        const dispatchData = {
            technicianCode: 'HIEUU',
            staffAssignments: [{ ktvId: 'HIEUU' }],
            itemUpdates: [{ id: 'mock-item-id', technicianCodes: ['HIEUU'], options: {} }]
        };

        const allKtvIds = new Set<string>();
        if (dispatchData.technicianCode) allKtvIds.add(dispatchData.technicianCode);
        if (dispatchData.staffAssignments) dispatchData.staffAssignments.forEach(a => { if (a.ktvId) allKtvIds.add(a.ktvId) });
        if (dispatchData.itemUpdates) dispatchData.itemUpdates.forEach(u => {
            if (u.technicianCodes) {
                if (Array.isArray(u.technicianCodes)) u.technicianCodes.forEach(c => { if (c) allKtvIds.add(c) });
                else if (typeof u.technicianCodes === 'string') allKtvIds.add(u.technicianCodes as string);
            }
        });
        const uniqueKtvIds = Array.from(allKtvIds).filter(Boolean);
        const externalNameMap: Record<string, string> = {};

        if (uniqueKtvIds.length > 0) {
            const { data: existingStaff, error: e1 } = await supabase.from('Staff').select('id').in('id', uniqueKtvIds);
            if (e1) throw e1;
            const existingIds = (existingStaff || []).map(s => s.id);
            const missingIds = uniqueKtvIds.filter(id => !existingIds.includes(id));
            
            console.log('missingIds:', missingIds);

            if (missingIds.length > 0) {
                // Lấy các mã EXT còn trống
                const { data: extStaff, error: e2 } = await supabase.from('Staff').select('id').ilike('id', 'EXT%');
                if (e2) throw e2;
                const { data: busyQueue, error: e3 } = await supabase.from('TurnQueue').select('employee_id');
                if (e3) throw e3;
                
                const busyIds = busyQueue?.map(q => q.employee_id) || [];
                const availableExt = (extStaff || []).map(s => s.id).filter(id => !busyIds.includes(id));
                
                console.log('availableExt:', availableExt.length);

                let extIndex = 0;
                const idReplacements: Record<string, string> = {};
                
                for (const missingName of missingIds) {
                    const extCode = availableExt[extIndex];
                    if (extCode) {
                        idReplacements[missingName] = extCode;
                        externalNameMap[extCode] = missingName;
                        extIndex++;
                        
                        // Cập nhật Tên thực tế vào options thay vì bảng Staff để tránh ảnh hưởng hệ thống
                        // User yêu cầu: "không lưu lại" -> Không lưu vào bảng Staff.
                    } else {
                        throw new Error(`Không đủ mã KTV Ngoài (Freelance) trống để gán cho: ${missingName}`);
                    }
                }
                
                console.log('idReplacements:', idReplacements);
                console.log('externalNameMap:', externalNameMap);

                // Rewrite IDs in dispatchData
                const replaceId = (id: string) => idReplacements[id] || id;
                if (dispatchData.technicianCode) dispatchData.technicianCode = replaceId(dispatchData.technicianCode);
                if (dispatchData.staffAssignments) dispatchData.staffAssignments.forEach(a => { if (a.ktvId) a.ktvId = replaceId(a.ktvId) });
                if (dispatchData.itemUpdates) dispatchData.itemUpdates.forEach(u => {
                    if (u.technicianCodes) {
                        if (Array.isArray(u.technicianCodes)) u.technicianCodes = u.technicianCodes.map(c => replaceId(c));
                        else if (typeof u.technicianCodes === 'string') u.technicianCodes = [replaceId(u.technicianCodes as string)];
                    }
                });

                console.log('updated dispatchData:', JSON.stringify(dispatchData, null, 2));

                // Mock Cập nhật tên KTV ngoài vào options của BookingItems ngay lập tức
                if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
                    for (const item of dispatchData.itemUpdates) {
                        console.log('Mock update BookingItems:', item.id, 'with opts', externalNameMap);
                    }
                }
            }
        }
        console.log('Test successful');
    } catch (e) {
        console.error('Error:', e);
    }
}
run();
