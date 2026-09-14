
with open('app/reception/dispatch/_components/SplitPreviewModal.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

replacements = {
    'Hệ thống sẽ tách đơn': 'H? th?ng s? t�ch don',
    '� ơn hàng của bạn sẽ được tách thành': '�on h�ng c?a b?n s? du?c t�ch th�nh',
    'đơn con': 'don con',
    'Khách ': 'Kh�ch ',
    'Dịch vụ': 'D?ch v?',
    'Hủy': 'H?y',
    'Chỉ Lưu Nháp': 'Ch? Luu Nh�p',
    'Lưu & Gửi KTV luôn': 'Luu & G?i KTV lu�n'
}

for k, v in replacements.items():
    text = text.replace(k, v)

with open('app/reception/dispatch/_components/SplitPreviewModal.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

