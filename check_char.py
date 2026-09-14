
with open('app/reception/dispatch/page.tsx', 'r', encoding='utf-8') as f:
    text = f.read()
if '\u0110' in text:
    print('Found correct Ð')
if '\xc4' in text:
    print('Found double encoded character starting with C4 (Ä)')

