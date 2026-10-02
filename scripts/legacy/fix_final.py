
import sys

def restore(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()
    
    if text.startswith('\ufeff'):
        text = text[1:]
        
    byte_list = []
    for i, c in enumerate(text):
        try:
            b = c.encode('cp1252')
            byte_list.append(b)
        except UnicodeEncodeError:
            if ord(c) < 256:
                byte_list.append(bytes([ord(c)]))
            else:
                print(f'Cannot map {c} (U+{ord(c):04x}) at pos {i}')
                return False
                
    recovered_bytes = b''.join(byte_list)
    try:
        recovered_text = recovered_bytes.decode('utf-8')
    except UnicodeDecodeError as e:
        print(f'Failed to decode recovered bytes for {filepath}: {e}')
        return False
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(recovered_text)
    print(f'Successfully restored {filepath}')
    return True

restore('app/reception/dispatch/page.tsx')
restore('app/reception/dispatch/_components/SplitPreviewModal.tsx')

