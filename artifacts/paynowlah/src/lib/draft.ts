import type { PaymentDetails } from './paynow';

export type ExpiryUnit = 'none' | 'hours' | 'days' | 'keep';

/** What the form holds while someone is still typing: raw, unchecked values. */
export interface Draft {
  type: PaymentDetails['type'];
  recipient: string;
  reference: string;
  amount: string;
  editable: boolean;
  unit: ExpiryUnit;
  count: string;
  /** The exact expiry being kept when unit is 'keep'. */
  expires?: number;
}

/** Marks a link as "still editing": it reopens the form instead of the finished QR. */
export const DRAFT_MARKER = 'edit';

const TYPES = ['mobile', 'uen', 'nric'] as const;

export function emptyDraft(): Draft {
  return { type: 'mobile', recipient: '', reference: '', amount: '', editable: false, unit: 'none', count: '24' };
}

export function draftFromDetails(d: PaymentDetails): Draft {
  return {
    type: d.type, recipient: d.recipient, reference: d.reference, amount: d.amount ?? '',
    editable: d.amount ? d.editable : false,
    unit: d.expires ? 'keep' : 'none', count: '24', expires: d.expires,
  };
}

export function isDraftEmpty(d: Draft): boolean {
  return !d.recipient && !d.reference && !d.amount;
}

/** The part after "#", or '' for an empty form. Values stay as typed, unchecked. */
export function draftToHash(d: Draft): string {
  if (isDraftEmpty(d)) return '';
  const p = new URLSearchParams();
  p.set(DRAFT_MARKER, '');
  p.set('type', d.type);
  if (d.recipient) p.set('recipient', d.recipient);
  if (d.reference) p.set('reference', d.reference);
  if (d.amount) p.set('amount', d.amount);
  if (d.editable) p.set('editable', 'true');
  if (d.unit === 'keep' && d.expires !== undefined) p.set('expires', String(d.expires));
  else if (d.unit === 'hours' || d.unit === 'days') { p.set('expiryUnit', d.unit); p.set('expiryCount', d.count); }
  return p.toString().replace(`${DRAFT_MARKER}=`, DRAFT_MARKER);
}

/** Reads a "still editing" link back; anything odd falls back to the empty form's value. */
export function draftFromParams(p: URLSearchParams): Draft {
  const d = emptyDraft();
  const type = p.get('type');
  if (TYPES.includes(type as Draft['type'])) d.type = type as Draft['type'];
  d.recipient = p.get('recipient') ?? '';
  d.reference = p.get('reference') ?? '';
  d.amount = p.get('amount') ?? '';
  d.editable = p.get('editable') === 'true';
  const expires = Number(p.get('expires'));
  const unit = p.get('expiryUnit');
  if (p.has('expires') && Number.isFinite(expires) && expires > 0) { d.unit = 'keep'; d.expires = expires; }
  else if (unit === 'hours' || unit === 'days') { d.unit = unit; d.count = p.get('expiryCount') ?? '24'; }
  return d;
}
