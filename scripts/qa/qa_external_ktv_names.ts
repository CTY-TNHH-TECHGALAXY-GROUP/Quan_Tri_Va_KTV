/**
 * ================================================================
 * MÔ PHỎNG: luật tên KTV ngoài không tài khoản (mở lại 15/09/2026)
 * ================================================================
 * Hàm thuần, không ghi DB. Dữ liệu giống thật: tên và mã placeholder đọc từ
 * `Staff` ngày 15/09 (C_50LQFT NGUYÊN ANH, EXT_DY95EP LISA - LUNA, EXT_5O1QU3 NH07…).
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_external_ktv_names.ts
 */
import {
    normalizeExternalKtvName, externalKtvNameKey, findExternalKtvByName, externalKtvNameProblem,
    newExternalKtvToken, isNewExternalKtvToken, externalNameOfToken, ktvDisplayLabel, isPlaceholderStaffId,
} from '@/lib/constants/staff.constants';
import { findKtvsNeedingCheckinConfirm } from '@/lib/attendance/dispatchCheckinGate';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : '  → ' + detail}`); };

const STAFFS = [
    { id: 'NH07', full_name: 'Nguyễn Thị Bảy', status: 'ĐANG LÀM' },
    { id: 'NH09', full_name: 'Trần Chín', status: 'ĐANG LÀM' },
    { id: 'NH99', full_name: 'Lan Cũ', status: 'ĐÃ NGHỈ' },
    { id: 'C001', full_name: 'KTV01', status: 'ĐANG LÀM' },          // loại C có tài khoản thật
    { id: 'C_50LQFT', full_name: 'NGUYÊN ANH', status: 'ĐANG LÀM' },
    { id: 'EXT_DY95EP', full_name: 'LISA - LUNA', status: 'ĐANG LÀM' },
    { id: 'EXT_5O1QU3', full_name: 'NH07', status: 'ĐANG LÀM' },     // rác cũ: gõ mã KTV nhà thành người ngoài
    { id: 'C_9HPU96', full_name: 'LISA', status: 'ĐÃ NGHỈ' },
    { id: 'EXT_AAAAAA', full_name: 'TÂM', status: 'ĐÃ NGHỈ' },
    { id: 'EXT_BBBBBB', full_name: 'TÂM', status: 'ĐANG LÀM' },
];

console.log('\nChuẩn hoá & khoá so khớp');
check('gộp khoảng trắng + in hoa', normalizeExternalKtvName('  nguyên   anh ') === 'NGUYÊN ANH');
check('không dấu: "nguyen anh" ≡ "NGUYÊN ANH"', externalKtvNameKey('nguyen anh') === externalKtvNameKey('NGUYÊN ANH'));
check('Đ → D', externalKtvNameKey('đào') === 'DAO');

console.log('\nTìm KTV ngoài có sẵn');
check('gõ "nguyên anh" → C_50LQFT (ca ảnh 15/09)', findExternalKtvByName('nguyên anh', STAFFS)?.id === 'C_50LQFT');
check('gõ không dấu "nguyen anh" → C_50LQFT', findExternalKtvByName('nguyen anh', STAFFS)?.id === 'C_50LQFT');
check('tên ghép "lisa - luna" → EXT_DY95EP', findExternalKtvByName('lisa - luna', STAFFS)?.id === 'EXT_DY95EP');
check('"lisa" khớp dòng ĐÃ NGHỈ (sẽ bật lại, không sinh trùng)', findExternalKtvByName('lisa', STAFFS)?.id === 'C_9HPU96');
check('2 dòng cùng tên: ưu tiên ĐANG LÀM', findExternalKtvByName('tâm', STAFFS)?.id === 'EXT_BBBBBB');
check('không so với KTV nhà: "Nguyễn Thị Bảy" → null', findExternalKtvByName('Nguyễn Thị Bảy', STAFFS) === null);
check('tên mới "HOA" → null', findExternalKtvByName('hoa', STAFFS) === null);

console.log('\nĐược thêm KTV ngoài mới không');
check('tên mới "hoa" → được', externalKtvNameProblem('hoa', STAFFS) === null);
check('tên ghép mới "mai - đào" → được (chốt 15/09)', externalKtvNameProblem('mai - đào', STAFFS) === null);
check('trùng mã KTV nhà "nh09" → chặn', (externalKtvNameProblem('nh09', STAFFS) || '').includes('NH09'));
check('trùng tên KTV nhà (không dấu) "tran chin" → chặn', (externalKtvNameProblem('tran chin', STAFFS) || '').includes('NH09'));
check('trùng tên KTV loại C có tài khoản "ktv01" → chặn', (externalKtvNameProblem('ktv01', STAFFS) || '').includes('C001'));
check('trùng KTV nhà ĐÃ NGHỈ "lan cũ" → được', externalKtvNameProblem('lan cũ', STAFFS) === null);
check('rỗng → chặn', externalKtvNameProblem('   ', STAFFS) !== null);
check('dài quá 60 → chặn', externalKtvNameProblem('A'.repeat(61), STAFFS) !== null);

console.log('\nMã tạm NEW_EXT');
const token = newExternalKtvToken('  mai  - đào ');
check('token dạng NEW_EXT:MAI - ĐÀO', token === 'NEW_EXT:MAI - ĐÀO', token);
check('nhận ra token (kể cả sau khi server in hoa)', isNewExternalKtvToken(token.toUpperCase()));
check('lấy lại tên từ token', externalNameOfToken(token) === 'MAI - ĐÀO');
check('token không bị coi là mã placeholder', !isPlaceholderStaffId(token));
check('ktvDisplayLabel hiện tên cho token', ktvDisplayLabel(null, token) === 'MAI - ĐÀO');
check('ktvDisplayLabel loại C placeholder hiện tên', ktvDisplayLabel('TYPE_C', 'C_50LQFT', 'NGUYÊN ANH') === 'NGUYÊN ANH');

console.log('\nCổng điểm danh (câu 4)');
const gate = findKtvsNeedingCheckinConfirm({
    ktvIds: ['C_50LQFT', 'EXT_DY95EP', 'C001', 'NH07'],
    staffById: new Map(STAFFS.map(s => [s.id, { full_name: s.full_name, work_type: s.id === 'NH07' ? 'TYPE_A' : 'TYPE_C' }])),
    checkedInIds: new Set<string>(),
    turnStatusById: new Map<string, string>(),
});
const asked = gate.map(g => g.id).sort();
check('KTV ngoài không tài khoản KHÔNG bị hỏi', !asked.includes('C_50LQFT') && !asked.includes('EXT_DY95EP'), JSON.stringify(asked));
check('loại C có tài khoản (C001) VẪN bị hỏi', asked.includes('C001'), JSON.stringify(asked));
check('KTV nhà chưa điểm danh VẪN bị hỏi', asked.includes('NH07'), JSON.stringify(asked));

console.log(`\n${pass} đạt · ${fail} hỏng`);
process.exit(fail ? 1 : 0);
