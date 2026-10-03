
import re

with open('app/reception/dispatch/page.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

find_regex = re.compile(
    r'let splitPlan = precomputedSplitPlan \|\| \[\];\s*if \(\!precomputedSplitPlan && \!clonedOrder\.parentBookingId\) \{\s*const groups = new Map<string, string\[\]>\(\);\s*clonedOrder\.services\.forEach\(svc => \{\s*if \(svc\.mergedIntoId \|\| svc\.options\?\.mergedIntoId\) return;\s*const groupId = svc\.customerGroupId \|\| svc\.id;'
)

replace_text = '''let splitPlan = precomputedSplitPlan || [];
      if (!precomputedSplitPlan && !clonedOrder.parentBookingId) {
          const groups = new Map<string, string[]>();
          const firstPrimary = clonedOrder.services.find((s: any) => !s.mergedIntoId && !s.options?.mergedIntoId);
          const defaultGroupId = firstPrimary?.customerGroupId || firstPrimary?.id || 'default';
          clonedOrder.services.forEach(svc => {
              if (svc.mergedIntoId || svc.options?.mergedIntoId) return;
              const groupId = svc.customerGroupId || defaultGroupId;'''

text, count = find_regex.subn(replace_text, text)
print(f'Replaced {count} occurrences')

with open('app/reception/dispatch/page.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

