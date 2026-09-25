# Plan: Cập nhật Bonus KTV (ĐÃ DUYỆT)

> Ngày duyệt: 2026-05-13

## Quyết định đã chốt:
1. **Công thức**: basePoints(CA MÌNH) / totalUniqueKTVs, dùng `Math.floor()`
2. **Config giữ nguyên**: ktv_shift_1_bonus=20, ktv_shift_2_bonus=20, ktv_shift_3_bonus=40
3. **Rating**: >= 4★ per booking (max 4★)
4. **DB mới**: KTVBonusLedger + feature flag `enable_bonus_wallet` (default: false)
5. **Admin**: Bỏ bonus khỏi gross_income, hiển thị riêng
6. **Feature OFF**: Vẫn tính bonus hiển thị, KHÔNG ghi DB
