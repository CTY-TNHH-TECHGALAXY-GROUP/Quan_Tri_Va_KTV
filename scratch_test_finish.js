// Simulate 2 KTVs, 1 DV, Sequential

const mockItem = {
    id: 'item1',
    status: 'IN_PROGRESS',
    itemRating: null,
    segments: JSON.stringify([
        { ktvId: 'KTV1', startTime: '10:00', duration: 60, actualStartTime: '2026-05-17T10:00:00Z', actualEndTime: null },
        { ktvId: 'KTV2', startTime: '11:00', duration: 60, actualStartTime: null, actualEndTime: null }
    ])
};

const items = [mockItem];

function simulateFinishService(technicianCode, status) {
    const isFeedback = status === 'FEEDBACK';
    const nowISO = new Date().toISOString();
    let originalItemsData = {};

    let allGlobalSegs = [];
    for (const item of items) {
        let segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : item.segments;
        originalItemsData[item.id] = [...segs];
        segs.forEach((seg, idx) => {
            if (seg.ktvId === technicianCode) {
                allGlobalSegs.push({ item, idx, seg, _itemId: item.id });
            }
        });
    }

    const uniqueItemIds = new Set(allGlobalSegs.map((s) => s._itemId));
    const isMerged = allGlobalSegs.length > 1 && uniqueItemIds.size === allGlobalSegs.length;

    if (isMerged && (status === 'CLEANING' || isFeedback)) {
        // ... (not merged in this case)
    } else {
        allGlobalSegs.forEach((target) => {
            if (status === 'CLEANING' || isFeedback) {
                if (!target.seg.actualEndTime) target.seg.actualEndTime = nowISO;
                if (isFeedback && !target.seg.feedbackTime) target.seg.feedbackTime = nowISO;
            }
            originalItemsData[target.item.id][target.idx] = target.seg;
        });
    }

    console.log(`\n--- Action: ${technicianCode} sends status = ${status} ---`);

    for (const item of items) {
        let segs = originalItemsData[item.id];
        
        const allSegsDone = segs.every((s) => !!s.actualEndTime);
        const alreadyRated = item.itemRating !== null && item.itemRating !== undefined;

        const newItemStatus = (item.status === 'DONE')
            ? 'DONE'
            : (alreadyRated && allSegsDone)
                ? 'DONE'
                : allSegsDone
                    ? (isFeedback ? 'FEEDBACK' : 'CLEANING')
                    : 'IN_PROGRESS';
        
        console.log(`🧠 [Smart Status] Item ${item.id}:`);
        console.log(`  allSegsDone=${allSegsDone}`);
        console.log(`  alreadyRated=${alreadyRated}`);
        console.log(`  -> New Status=${newItemStatus}`);
        
        // Update mock data
        item.segments = JSON.stringify(segs);
        item.status = newItemStatus;
    }
}

console.log("Initial state:", JSON.parse(items[0].segments));

// KTV 1 finishes timer -> status: CLEANING
simulateFinishService('KTV1', 'CLEANING');

// KTV 1 submits rating -> no effect on segments, but wait, handleSubmitReview doesn't change status directly?
// No, it just saves notes.

// KTV 1 handover -> status: FEEDBACK
simulateFinishService('KTV1', 'FEEDBACK');

console.log("Final segments:", JSON.parse(items[0].segments));
console.log("Final item status:", items[0].status);
