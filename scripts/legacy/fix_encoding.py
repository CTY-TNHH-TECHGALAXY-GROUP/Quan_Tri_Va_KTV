
import os

def fix_file(filepath):
    with open(filepath, 'rb') as f:
        raw = f.read()
    
    corrupted_text = raw.decode('utf-8')
    if corrupted_text.startswith('\ufeff'):
        corrupted_text = corrupted_text[1:]
        
    try:
        # Encode back to cp1252 to get the original UTF-8 bytes
        recovered_bytes = corrupted_text.encode('cp1252')
        recovered_text = recovered_bytes.decode('utf-8')
        
        with open(filepath, 'wb') as f:
            f.write(recovered_text.encode('utf-8'))
        print('Fixed:', filepath)
    except Exception as e:
        print('Failed to fix:', filepath, e)

fix_file('app/reception/dispatch/page.tsx')
fix_file('app/reception/dispatch/_components/SplitPreviewModal.tsx')

