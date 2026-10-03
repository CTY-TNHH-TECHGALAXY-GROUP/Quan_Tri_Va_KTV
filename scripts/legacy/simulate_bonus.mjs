const mockData = [
  { name: '1 KTV - Ca 1 - Làm đủ 60p', shift: 'SHIFT_1', ktvId: 'KTV01', duration: 60, totalKtvs: 1, s1: 20, s2: 20, s3: 30 },
  { name: '1 KTV - Ca 1 - Làm 30p (dưới 60p)', shift: 'SHIFT_1', ktvId: 'KTV01', duration: 30, totalKtvs: 1, s1: 20, s2: 20, s3: 30 },
  { name: '1 KTV - Ca 3 - Làm đủ 60p', shift: 'SHIFT_3', ktvId: 'KTV01', duration: 60, totalKtvs: 1, s1: 20, s2: 20, s3: 30 },
  { name: '1 KTV - Ca 3 - Làm 45p (dưới 60p)', shift: 'SHIFT_3', ktvId: 'KTV01', duration: 45, totalKtvs: 1, s1: 20, s2: 20, s3: 30 },
  { name: '2 KTV chia nhau - Ca 1 - KTV1 (30p) & KTV2 (60p)', shift: 'SHIFT_1', ktvs: [{id: 'KTV1', d: 30}, {id: 'KTV2', d: 60}], totalKtvs: 2, s1: 20, s2: 20, s3: 30 }
];

console.log('====== MÔ PHỎNG THUẬT TOÁN TÍNH ĐIỂM VÍ BONUS ======');
mockData.forEach(scenario => {
    let base = scenario.s1;
    if (scenario.shift === 'SHIFT_2') base = scenario.s2;
    if (scenario.shift === 'SHIFT_3') base = scenario.s3;

    if (scenario.ktvs) {
        console.log(`\n[${scenario.name}]`);
        scenario.ktvs.forEach(k => {
            let pts = base;
            if (k.d < 60) pts = pts / 2;
            const finalPts = Math.floor(pts / scenario.totalKtvs);
            console.log(`- ${k.id}: Thời gian ${k.d}p -> Điểm gốc sau khi xét TG: ${pts}đ -> Chia cho ${scenario.totalKtvs} người -> Thực nhận: ${finalPts}đ`);
        });
    } else {
        let pts = base;
        if (scenario.duration < 60) pts = pts / 2;
        const finalPts = Math.floor(pts / scenario.totalKtvs);
        console.log(`\n[${scenario.name}]`);
        console.log(`- ${scenario.ktvId}: Thời gian ${scenario.duration}p -> Điểm gốc sau khi xét TG: ${pts}đ -> Chia cho ${scenario.totalKtvs} người -> Thực nhận: ${finalPts}đ`);
    }
});
