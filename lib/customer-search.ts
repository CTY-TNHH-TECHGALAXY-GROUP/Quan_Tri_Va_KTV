export function phoneSearchVariants(raw: string): string[] {
  const value = (raw || '').trim();
  if (!value || !/^[+\d\s().-]+$/.test(value)) return [];

  const digits = value.replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits)) return [];

  const variants = new Set<string>();
  const explicit = value;
  const national = (() => {
    if (digits.startsWith('84') && digits.length === 11) return '0' + digits.slice(2);
    if (digits.startsWith('840') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('0') && digits.length === 10) return digits;
    if (digits.length === 9) return '0' + digits;
    return digits;
  })();

  [explicit, digits, national].forEach((item) => {
    if (item && item.trim()) variants.add(item.trim());
  });

  if (/^0\d{9}$/.test(national)) {
    variants.add('+84' + national.slice(1));
    variants.add('84' + national.slice(1));
    variants.add('+84' + national);
    variants.add('84' + national);
  }

  return [...variants];
}

export function searchPattern(value: string): string {
  const safe = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return JSON.stringify(`%${safe}%`);
}

export function customerSearchFilter(raw: string): string {
  const query = (raw || '').trim();
  if (!query) return 'id.is.null';

  const fieldClauses = ['fullName', 'email', 'taxCode', 'companyName']
    .map((field) => `${field}.ilike.${searchPattern(query)}`);

  const phoneClauses = [...new Set([query, ...phoneSearchVariants(query)])]
    .filter((value) => value && value.trim())
    .map((value) => `phone.ilike.${searchPattern(value)}`);

  return [...fieldClauses, ...phoneClauses].join(',');
}

export function matchesCustomerSearch(customer: any, raw: string): boolean {
  const query = (raw || '').trim().toLowerCase();
  if (!query) return true;

  const candidateValues = [
    customer?.fullName,
    customer?.phone,
    customer?.email,
    customer?.taxCode,
    customer?.companyName,
  ];

  if (candidateValues.some((value) => (value || '').toString().toLowerCase().includes(query))) {
    return true;
  }

  const storedPhones = phoneSearchVariants(customer?.phone || '');
  const queryPhones = phoneSearchVariants(query);
  return queryPhones.some((value) => storedPhones.some((phone) => phone.includes(value)));
}

export function phoneIdentity(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';

  const digits = value.replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits)) return '';

  if (digits.startsWith('84') && digits.length === 11) return '0' + digits.slice(2);
  if (digits.startsWith('840') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return '0' + digits;
  return digits;
}

export function contactFilter(phone: string | null, email: string | null, booking = false): string {
  const phoneColumn = booking ? 'customerPhone' : 'phone';
  const emailColumn = booking ? 'customerEmail' : 'email';
  const clauses: string[] = [];

  if (phone) {
    const normalizedPhone = phoneIdentity(phone);
    if (normalizedPhone) {
      const values = [...new Set(phoneSearchVariants(phone).concat(normalizedPhone))];
      clauses.push(`${phoneColumn}.in.(${values.map((value) => JSON.stringify(value)).join(',')})`);
    }
  }

  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
      clauses.push(`${emailColumn}.ilike.${searchPattern(normalizedEmail)}`);
    }
  }

  return clauses.join(',');
}

export function sameContact(row: any, phone: string | null, email: string | null): boolean {
  const targetPhone = phoneIdentity(phone || '');
  const targetEmail = (email || '').trim().toLowerCase();

  const rowPhone = phoneIdentity(row?.phone || row?.customerPhone || '');
  const rowEmail = (row?.email || row?.customerEmail || '').trim().toLowerCase();

  if (targetPhone && rowPhone) {
    return rowPhone === targetPhone;
  }

  if (targetEmail && rowEmail) {
    return rowEmail === targetEmail;
  }

  return false;
}

export function completedVisitCount(all: any[] = [], statuses: string[] = []): number {
  const byId = new Map((all || []).filter(Boolean).map((row) => [row.id, row]));
  const roots = new Set<string>();

  for (const row of all || []) {
    if (!row || !statuses.includes(row.status)) continue;

    let cursor = row.id;
    const seen = new Set<string>();

    while (byId.get(cursor)?.parent_booking_id) {
      if (seen.has(cursor)) {
        throw new Error(`Chuỗi đơn tách có vòng lặp: ${[...seen, cursor].join(' -> ')}`);
      }
      seen.add(cursor);
      const parentId = byId.get(cursor)?.parent_booking_id;
      if (!parentId || parentId === cursor) break;
      cursor = parentId;
    }

    roots.add(cursor);
  }

  return roots.size;
}
