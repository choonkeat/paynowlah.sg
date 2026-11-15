export interface PaymentDetails {
  type: 'mobile' | 'uen';
  recipient: string;
  reference: string;
  amount?: string;
  editable: boolean;
  /** Absolute Unix timestamp in milliseconds; never recomputed on reload. */
  expires?: number;
}

export function validatePayment(input: PaymentDetails): PaymentDetails {
  if (input.type !== 'mobile' && input.type !== 'uen') {
    throw new Error('Choose a mobile number or UEN.');
  }
  let recipient = input.recipient.trim().replace(/[\s()-]/g, '');
  if (input.type === 'mobile') {
    recipient = recipient.replace(/^(?:\+65|65)(?=[89]\d{7}$)/, '');
    if (!/^[89]\d{7}$/.test(recipient)) {
      throw new Error('Enter an 8-digit Singapore mobile number starting with 8 or 9.');
    }
    recipient = `+65${recipient}`;
  } else {
    recipient = recipient.toUpperCase();
    // Business, company and other registered-entity UEN formats, with optional PayNow suffix.
    if (!/^(?:\d{8}[A-Z]|\d{9}[A-Z]|[ST]\d{2}[A-Z]{2}\d{4}[A-Z])(?:[A-Z0-9]{3})?$/.test(recipient)) {
      throw new Error('Enter a valid Singapore UEN, optionally followed by its 3-character PayNow suffix.');
    }
  }
  const reference = input.reference.trim();
  if (reference.length > 25 || /[^\x20-\x7E]/.test(reference)) {
    throw new Error('Use up to 25 letters, numbers or standard English punctuation for the reference.');
  }
  let amount: string | undefined;
  if (input.amount !== undefined && input.amount !== '') {
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
      throw new Error('Enter a positive SGD amount with no more than 2 decimal places.');
    }
    amount = Number(input.amount).toFixed(2);
  }
  if (input.expires !== undefined && (
    !Number.isSafeInteger(input.expires) || input.expires <= 0 ||
    input.expires > 253402271999000
  )) {
    throw new Error('The expiry date is invalid. Please create a new QR code.');
  }
  return { type: input.type, recipient, reference, amount, editable: amount ? input.editable : true, expires: input.expires };
}

export function parsePayment(search: string): PaymentDetails | null {
  const params = new URLSearchParams(search);
  if (!params.has('recipient')) return null;
  const editable = params.get('editable');
  if (editable !== null && !['true', 'false', '1', '0'].includes(editable)) {
    throw new Error('The amount setting in this link is invalid.');
  }
  return validatePayment({
    type: params.get('type') as PaymentDetails['type'],
    recipient: params.get('recipient') ?? '',
    reference: params.get('reference') ?? '',
    amount: params.get('amount') || undefined,
    editable: editable !== 'false' && editable !== '0',
    expires: params.has('expires') ? Number(params.get('expires')) : undefined,
  });
}

export function buildPaymentParams(input: PaymentDetails): URLSearchParams {
  const details = validatePayment(input);
  const params = new URLSearchParams({
    type: details.type, recipient: details.recipient, reference: details.reference,
  });
  if (details.amount) {
    params.set('amount', details.amount);
    params.set('editable', String(details.editable));
  }
  if (details.expires !== undefined) params.set('expires', String(details.expires));
  return params;
}

export function formatRecipient(details: PaymentDetails): string {
  if (details.type === 'uen') return details.recipient;
  const digits = details.recipient.replace(/^\+65/, '');
  return `+65 ${digits.slice(0, 4)} ${digits.slice(4)}`;
}

export function isExpired(details: PaymentDetails): boolean {
  return details.expires !== undefined && Date.now() >= details.expires;
}

function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error('Payment field is too long.');
  return tag + String(value.length).padStart(2, '0') + value;
}

export function crc16(value: string): string {
  let crc = 0xFFFF;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPayload(input: PaymentDetails): string {
  const details = validatePayment(input);
  // PayNow expiry accepts yyyyMMddHHmmss, expressed in Singapore local time.
  const expiry = details.expires === undefined ? '' :
    new Date(details.expires + 8 * 3600_000).toISOString().slice(0, 19).replace(/\D/g, '');
  const merchant = tlv('00', 'SG.PAYNOW') +
    tlv('01', details.type === 'mobile' ? '0' : '2') +
    tlv('02', details.recipient) + tlv('03', details.editable ? '1' : '0') +
    (expiry ? tlv('04', expiry) : '');
  const payload = tlv('00', '01') + tlv('01', '11') + tlv('26', merchant) +
    tlv('52', '0000') + tlv('53', '702') +
    (details.amount ? tlv('54', details.amount) : '') +
    tlv('58', 'SG') + tlv('59', 'NA') + tlv('60', 'Singapore') +
    (details.reference ? tlv('62', tlv('01', details.reference)) : '') + '6304';
  return payload + crc16(payload);
}
