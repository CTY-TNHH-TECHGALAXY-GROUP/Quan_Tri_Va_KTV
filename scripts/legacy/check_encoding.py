
with open('app/reception/dispatch/page.tsx', 'rb') as f:
    raw = f.read()

text = raw.decode('utf-8')
if '\xc3' in text or '\xc4' in text:
    print('Double encoding detected!')
else:
    print('No double encoding detected based on C3/C4 bytes in string representation.')

