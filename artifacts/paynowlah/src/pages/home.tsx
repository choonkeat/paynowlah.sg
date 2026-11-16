import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, Download, ImageUp, Link2, Loader2, Pencil, RotateCcw, ShieldCheck, AlertTriangle, Clock, X } from 'lucide-react';
import { parsePayNowText, preloadQrReader, readQrImage } from '@/lib/import-qr';
import {
  parsePayment,
  validatePayment,
  buildPaymentParams,
  formatRecipient,
  isExpired,
  type PaymentDetails,
} from '@/lib/paynow';
import { renderPaymentImage } from '@/lib/qr-image';
import { DRAFT_MARKER, draftFromDetails, draftFromParams, draftToHash, emptyDraft, type Draft, type ExpiryUnit } from '@/lib/draft';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/';

function shareUrl(details: PaymentDetails): string {
  return `${window.location.origin}${BASE}#${buildPaymentParams(details).toString()}`;
}

const REPO_URL = 'https://github.com/choonkeat/paynowlah.sg';

/** Corner badge linking to the source code. */
function GitHubCorner() {
  return (
    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" title="View source on GitHub"
      className="group absolute right-0 top-0 z-10 text-background focus-visible:outline-none" data-testid="link-github">
      <svg width="72" height="72" viewBox="0 0 250 250" aria-hidden className="fill-primary transition-colors group-hover:fill-accent">
        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
        <path fill="currentColor"
          d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" />
        <path fill="currentColor"
          d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" />
      </svg>
    </a>
  );
}

const TYPE_LABEL = { mobile: 'Mobile', uen: 'UEN', nric: 'NRIC/FIN' } as const;

/** From bank app tests: UEN payees get a locked reference, mobile payees can edit it. NRIC is untested. */
function referenceLabel(type: PaymentDetails['type']): string {
  return type === 'uen' ? 'Uneditable reference' : type === 'mobile' ? 'Editable reference' : 'Reference';
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Something in those details does not look right.';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pn-grain min-h-[100dvh] relative overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-accent/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-72 -left-40 h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
      <GitHubCorner />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between py-5 pl-5 pr-20 sm:pl-8 sm:pr-24">
        <a href={BASE} className="group flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-home">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-primary-foreground font-extrabold text-lg transition-transform group-hover:-rotate-6">P</span>
          <span className="text-xl font-extrabold tracking-tight">Paynow<span className="text-accent">lah</span></span>
        </a>
        <span className="hidden sm:inline font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">No login. No storage. Just a link.</span>
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pb-16 sm:px-8">{children}</main>
      <footer className="relative mx-auto max-w-6xl px-5 pb-10 sm:px-8 text-sm text-muted-foreground">
        <p className="max-w-2xl">Paynowlah only draws a QR code. It does not process, receive or confirm any payment. Always check the payment in your own bank app. PayNow is a service of the Association of Banks in Singapore; this tool is not affiliated with it.</p>
      </footer>
    </div>
  );
}

type Preview = { details: PaymentDetails | null; problem: string | null };

/** Keeps what is typed in the address (without adding Back-button steps), so a reload brings it back. */
function saveDraft(draft: Draft) {
  const hash = draftToHash(draft);
  const url = hash ? `${BASE}#${hash}` : BASE;
  if (url !== window.location.pathname + window.location.hash) window.history.replaceState(window.history.state, '', url);
}

function GeneratorForm({ initial, onPreview }: { initial?: Draft | null; onPreview?: (p: Preview) => void }) {
  const start = initial ?? emptyDraft();
  const keepExpires = start.unit === 'keep' ? start.expires : undefined;
  const [type, setType] = useState<PaymentDetails['type']>(start.type);
  const [recipient, setRecipient] = useState(start.recipient);
  // Check the payee once the person leaves the box or switches type, not on every keystroke.
  const [checkRecipient, setCheckRecipient] = useState(!!start.recipient);
  const recipientError = useMemo(() => {
    if (!checkRecipient || !recipient.trim()) return null;
    try {
      validatePayment({ type, recipient: recipient.trim(), reference: '', editable: true });
      return null;
    } catch (err) {
      return errMsg(err);
    }
  }, [checkRecipient, type, recipient]);
  const [reference, setReference] = useState(start.reference);
  const [amount, setAmount] = useState(start.amount);
  const [editable, setEditable] = useState(start.editable);
  const [unit, setUnit] = useState<ExpiryUnit>(keepExpires ? 'keep' : start.unit === 'keep' ? 'none' : start.unit);
  const [count, setCount] = useState(start.count);
  const [error, setError] = useState<string | null>(null);

  const nonAscii = /[^\x20-\x7E]/.test(reference);

  useEffect(() => {
    saveDraft({ type, recipient, reference, amount, editable, unit, count, expires: keepExpires });
  }, [type, recipient, reference, amount, editable, unit, count, keepExpires]);

  // Live preview: the same checks as "Make my QR link", run on every change.
  useEffect(() => {
    if (!onPreview) return;
    if (!recipient.trim()) { onPreview({ details: null, problem: null }); return; }
    let expires: number | undefined;
    if (unit === 'keep') expires = keepExpires;
    else if (unit !== 'none') {
      const n = Number(count);
      if (!Number.isInteger(n) || n <= 0) { onPreview({ details: null, problem: 'Expiry needs a whole number greater than zero.' }); return; }
      expires = Date.now() + n * (unit === 'hours' ? 3600_000 : 86_400_000);
    }
    const hasAmount = amount.trim() !== '';
    try {
      onPreview({ details: validatePayment({
        type, recipient: recipient.trim(), reference,
        amount: hasAmount ? amount.trim() : undefined,
        editable: hasAmount ? editable : true, expires,
      }), problem: null });
    } catch (err) {
      onPreview({ details: null, problem: errMsg(err) });
    }
  }, [onPreview, type, recipient, reference, amount, editable, unit, count, keepExpires]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let expires: number | undefined;
    if (unit === 'keep') expires = keepExpires;
    else if (unit !== 'none') {
      const n = Number(count);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        setError('Expiry needs a whole number greater than zero.');
        return;
      }
      expires = Date.now() + n * (unit === 'hours' ? 3600_000 : 86_400_000);
    }
    const hasAmount = amount.trim() !== '';
    try {
      const details = validatePayment({
        type,
        recipient: recipient.trim(),
        reference,
        amount: hasAmount ? amount.trim() : undefined,
        editable: hasAmount ? editable : true,
        expires,
      });
      window.location.assign(shareUrl(details));
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const field = 'w-full rounded-xl border border-input bg-card px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15';
  const label = 'mb-1.5 block text-sm font-semibold';

  return (
    <form method="get" action={BASE} onSubmit={onSubmit} noValidate className="pn-rise rounded-[1.6rem] border border-card-border bg-card/90 p-5 shadow-[0_30px_60px_-30px_hsl(296_62%_30%/0.35)] backdrop-blur sm:p-7" aria-describedby={error ? 'form-error' : undefined} data-testid="form-generator">
      <fieldset className="mb-5">
        <legend className={label}>Pay to</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {(['mobile', 'uen', 'nric'] as const).map((t) => (
            <label key={t} className={`cursor-pointer rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${type === t ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => { setType(t); setCheckRecipient(true); }} className="sr-only" data-testid={`radio-type-${t}`} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-5">
        <label htmlFor="recipient" className={label}>{type === 'mobile' ? 'Mobile number' : type === 'nric' ? 'NRIC or FIN' : 'UEN'}</label>
        <input id="recipient" name="recipient" required value={recipient} onChange={(e) => setRecipient(e.target.value)} onBlur={() => setCheckRecipient(true)} aria-invalid={!!recipientError} aria-describedby={recipientError ? 'recipient-error' : undefined} inputMode={type === 'mobile' ? 'tel' : 'text'} autoComplete={type === 'mobile' ? 'tel' : 'off'} placeholder={type === 'mobile' ? '9123 4567' : type === 'nric' ? 'S1234567D' : '201912345K'} className={`${field} font-mono ${recipientError ? 'border-destructive focus:border-destructive focus:ring-destructive/15' : ''}`} data-testid="input-recipient" />
        {recipientError && <p id="recipient-error" role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-destructive" data-testid="text-recipient-error"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{recipientError}</p>}
        {type === 'nric' && (
          <ul className="mt-1.5 space-y-1 text-xs font-semibold text-accent" data-testid="text-nric-warning">
            <li className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />Bank apps may refuse NRIC/FIN QR codes. Typing the NRIC/FIN into the bank app&rsquo;s &ldquo;PayNow to NRIC&rdquo; works, so the payer can do that instead.</li>
            <li className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />Anyone with your link can read the full NRIC/FIN. Share it only with people you trust.</li>
          </ul>
        )}
      </div>

      <div className="mb-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reference" className={label} data-testid="label-reference">{referenceLabel(type)} <span className="font-normal text-muted-foreground">(optional)</span></label>
          <span className={`font-mono text-xs ${reference.length > 25 ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">{reference.length}/25</span>
        </div>
        <input id="reference" name="reference" maxLength={25} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Durian party share" aria-describedby="reference-hint" className={field} data-testid="input-reference" />
        <p id="reference-hint" className={`mt-1.5 text-xs ${nonAscii ? 'text-destructive' : 'text-muted-foreground'}`}>{nonAscii ? 'Plain letters, numbers and basic symbols only.' : 'Shows up in the payer\u2019s bank app. Up to 25 plain characters.'}</p>
      </div>

      <div className="mb-5">
        <label htmlFor="amount" className={label}>Amount <span className="font-normal text-muted-foreground">(optional)</span></label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-muted-foreground">SGD</span>
          <input id="amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.50" className={`${field} pl-14 font-mono`} data-testid="input-amount" />
        </div>
        <div className={`grid transition-all duration-300 ${amount.trim() ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <fieldset disabled={!amount.trim()} className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Can the payer change the amount?</legend>
              {[{ v: false, t: 'Fixed', d: 'Payer cannot change it' }, { v: true, t: 'Editable', d: 'Payer may adjust it' }].map((o) => (
                <label key={o.t} className={`cursor-pointer rounded-xl border px-3 py-2.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${editable === o.v ? 'border-accent bg-secondary' : 'border-input hover:border-accent/50'}`}>
                  <input type="radio" name="editable" value={String(o.v)} checked={editable === o.v} onChange={() => setEditable(o.v)} className="sr-only" data-testid={`radio-editable-${o.t.toLowerCase()}`} />
                  <span className="block text-sm font-semibold">{o.t}</span>
                  <span className="block text-xs text-muted-foreground">{o.d}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="expiry-unit" className={label}>Expiry <span className="font-normal text-muted-foreground">(optional)</span></label>
        <div className="flex gap-2">
          {(unit === 'hours' || unit === 'days') && (
            <input aria-label="Expiry amount" type="number" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} className={`${field} w-24 font-mono`} data-testid="input-expiry-count" />
          )}
          <select id="expiry-unit" value={unit} onChange={(e) => setUnit(e.target.value as ExpiryUnit)} className={`${field} flex-1`} data-testid="select-expiry-unit">
            <option value="none">Never expires</option>
            {keepExpires && <option value="keep">Keep current ({new Date(keepExpires).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) + ' SGT'})</option>}
            <option value="hours">Hours from now</option>
            <option value="days">Days from now</option>
          </select>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Saved as an exact Singapore time when you generate, so refreshing or bookmarking the link does not extend it. Bank apps may handle expiry differently.</p>
      </div>

      {error && (
        <p id="form-error" role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="text-form-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <button type="submit" className="group flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-4 text-base font-bold text-primary-foreground transition hover:bg-[hsl(296_62%_25%)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40" data-testid="button-generate">
        Make my QR link <Link2 className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
    </form>
  );
}

function PreviewCard({ preview }: { preview: Preview }) {
  const [img, setImg] = useState<string | null>(null);
  const { details, problem } = preview;
  useEffect(() => {
    setImg(null);
    if (!details) return;
    let alive = true;
    const t = setTimeout(() => {
      renderPaymentImage(details).then((d) => alive && setImg(d)).catch(() => alive && setImg(null));
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [details]);

  return (
    <div className="pn-pop mx-auto w-full max-w-[19rem]" data-testid="card-preview">
      <div className="rounded-[1.6rem] bg-primary p-3 shadow-[0_40px_70px_-30px_hsl(296_62%_25%/0.7)]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-[1.1rem] bg-card">
          {details && img ? (
            <img src={img} alt="Live preview of your PayNow QR code" className="block h-full w-full" data-testid="img-preview" />
          ) : (
            <div className="p-6 text-center">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">Live preview</p>
              <p className="mt-2 text-lg font-extrabold">{details ? 'Drawing\u2026' : 'Your QR appears here'}</p>
              <p className="mt-1 text-sm text-muted-foreground" aria-live="polite" data-testid="text-preview-problem">{problem ?? (details ? '' : 'Fill in who to pay to start.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportBox({ onImport }: { onImport: (details: PaymentDetails) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'picture' | 'text'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Focus only after the box has slid in and scrolled into view. Focusing at once
  // opens the iPhone keyboard mid-animation, which can push the box out of sight.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const t = setTimeout(() => textRef.current?.focus({ preventScroll: true }), 650);
    return () => clearTimeout(t);
  }, [open]);

  async function use(source: Blob | string) {
    setError(null);
    setBusy(typeof source === 'string' ? 'text' : 'picture');
    try {
      const raw = typeof source === 'string' ? source : await readQrImage(source);
      onImport(parsePayNowText(raw));
      setOpen(false); setText(''); setDone(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const image = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (image) { e.preventDefault(); void use(image); return; }
    const pasted = e.clipboardData.getData('text');
    if (pasted.trim().startsWith('000201')) { e.preventDefault(); setText(pasted.trim()); void use(pasted); }
  }

  if (!open) {
    return (
      <div className="mb-3 flex items-center justify-end gap-3 text-sm">
        {done && <span className="text-muted-foreground" role="status" data-testid="text-import-done">Filled in from your QR code. Check it, then make your link.</span>}
        <button type="button" onClick={() => { setOpen(true); setDone(false); preloadQrReader(); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="button-import-open">
          <ImageUp className="h-4 w-4" aria-hidden />Import a PayNow QR
        </button>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="pn-rise mb-4 scroll-mt-4 rounded-[1.4rem] border border-card-border bg-card/90 p-5 backdrop-blur" data-testid="panel-import">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Import a PayNow QR</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Paste a screenshot of the QR code, or the text a QR scanner app shows. It stays in your browser.</p>
        </div>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} aria-label="Close import" className="rounded-lg p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="button-import-close"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <textarea ref={textRef} disabled={!!busy} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} rows={3} placeholder="Paste here" aria-label="QR screenshot or QR text" className="mt-3 w-full resize-none rounded-xl border border-input bg-card px-4 py-3 font-mono text-xs outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15" data-testid="input-import-text" />
      {busy && <p role="status" className="mt-2 flex items-center gap-2 text-sm font-semibold text-primary" data-testid="text-import-busy"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{busy === 'picture' ? 'Reading the picture\u2026 this can take a few seconds.' : 'Reading the text\u2026'}</p>}
      {error && <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-destructive" data-testid="text-import-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-bold transition hover:border-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40" data-testid="button-import-file">
          <ImageUp className="h-4 w-4" aria-hidden />Choose picture
        </button>
        <button type="button" disabled={!!busy || !text.trim()} onClick={() => void use(text)} className="rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-[hsl(296_62%_25%)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40" data-testid="button-import-text">
          Use this text
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void use(f); }} data-testid="input-import-file" />
    </div>
  );
}

function FormPage({ initial }: { initial?: Draft | null }) {
  const [preview, setPreview] = useState<Preview>({ details: null, problem: null });
  const [imported, setImported] = useState<{ draft: Draft; n: number } | null>(null);
  // Opened with "Edit" on a QR page: offer the way back to it.
  const fromResult = !!(window.history.state as { fromResult?: boolean } | null)?.fromResult;
  return (
    <>
      {fromResult && <button onClick={() => window.history.back()} className="mt-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="button-cancel-edit"><ArrowLeft className="h-4 w-4" aria-hidden />Back to QR</button>}
      <div className="grid items-start gap-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-12">
        <section className="pn-rise">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">PayNow QR, in one link</p>
          <h1 className="mt-3 text-[clamp(2.5rem,7vw,4.6rem)] font-extrabold leading-[0.95] tracking-tight">
            {fromResult ? 'Tweak it, then' : 'Pay & Get Paid'}
            <span className={`block text-primary ${fromResult ? '' : 'mt-4 text-[clamp(1.25rem,3vw,1.75rem)] font-bold leading-snug tracking-normal'}`}>{fromResult ? 'share again.' : 'Correctly & easily with a prefilled Paynow QR'}</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">Correct amount. Correct reference text. Save into Photos app for reuse.</p>
          <div className="mt-10 hidden lg:block"><PreviewCard preview={preview} /></div>
          <ul className="mt-10 hidden gap-3 text-sm lg:grid">
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />Your details live only in the link and your browser.</li>
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />The payer&rsquo;s bank app shows the real recipient name before they pay.</li>
          </ul>
        </section>
        <div>
          <ImportBox onImport={(details) => setImported((prev) => ({ draft: draftFromDetails(details), n: (prev?.n ?? 0) + 1 }))} />
          <GeneratorForm key={imported?.n ?? 0} initial={imported?.draft ?? initial} onPreview={setPreview} />
        </div>
      </div>
    </>
  );
}

function ResultPage({ details }: { details: PaymentDetails }) {
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const expired = isExpired(details);
  useEffect(() => {
    if (!details.expires || expired) return;
    const ms = Math.min(details.expires - Date.now() + 50, 2_000_000_000);
    const t = setTimeout(() => { setImg(null); tick((n) => n + 1); }, Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [details, expired]);

  useEffect(() => {
    if (expired) return;
    let alive = true;
    setImg(null);
    setImgErr(null);
    renderPaymentImage(details).then((d) => alive && setImg(d)).catch((e) => alive && setImgErr(errMsg(e)));
    return () => { alive = false; };
  }, [details, expired]);

  async function copy() {
    await copyText(shareUrl(details));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function edit() {
    window.history.pushState({ fromResult: true }, '', `${BASE}#${draftToHash(draftFromDetails(details))}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  const fname = `paynow-${details.reference.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'qr'}.png`;
  const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40';

  return (
    <div className="grid items-start gap-10 pt-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16 lg:pt-10">
      <div className="pn-pop mx-auto w-full max-w-[26rem]">
        <div className="rounded-[1.8rem] bg-primary p-3 shadow-[0_40px_80px_-35px_hsl(296_62%_25%/0.75)]">
          <div className={`relative grid ${img && !expired ? '' : 'aspect-[4/5]'} place-items-center overflow-hidden rounded-[1.3rem] bg-card`}>
            {expired ? (
              <div className="p-8 text-center" role="status" data-testid="status-expired">
                <Clock className="mx-auto h-10 w-10 text-accent" aria-hidden />
                <p className="mt-3 text-2xl font-extrabold">This link has expired</p>
                <p className="mt-2 text-sm text-muted-foreground">Expired {new Date(details.expires!).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) + ' SGT'}. Ask the sender for a fresh one.</p>
              </div>
            ) : imgErr ? (
              <div className="p-8 text-center" role="alert">
                <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
                <p className="mt-3 font-semibold">Could not draw the QR image.</p>
                <p className="mt-1 text-sm text-muted-foreground">{imgErr}</p>
                <button onClick={() => window.location.reload()} className={`${btn} mt-4 bg-secondary text-secondary-foreground`} data-testid="button-retry">Try again</button>
              </div>
            ) : img ? (
              <img src={img} alt={`PayNow QR code to pay ${formatRecipient(details)}${details.amount ? `, SGD ${details.amount}` : ''}${details.reference ? `, reference ${details.reference}` : ''}`} className="block h-auto w-full transition-opacity duration-500" data-testid="img-qr" />
            ) : (
              <div className="w-3/4 space-y-4" aria-label="Drawing QR code" role="status">
                <div className="aspect-square animate-pulse rounded-2xl bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="pn-rise" style={{ animationDelay: '.1s' }}>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">{expired ? 'Expired link' : 'Ready to scan'}</p>
        {details.type === 'nric' && !expired && <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-accent/10 px-3 py-2 text-sm font-semibold text-accent" data-testid="text-nric-result-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>Bank apps may refuse QR codes that pay to an NRIC/FIN. If yours does, open PayNow in your bank app, choose &ldquo;PayNow to NRIC&rdquo; and type <span className="font-mono" data-testid="text-nric-full">{details.recipient}</span>.</span></p>}
        <h1 className="mt-2 text-[clamp(2.2rem,6vw,3.8rem)] font-extrabold leading-none tracking-tight" data-testid="text-amount">
          {details.amount ? <>SGD {details.amount}</> : 'Any amount'}
        </h1>
        <dl className="mt-6 grid gap-x-8 gap-y-4 border-y border-border py-5 sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">To {details.type === 'uen' ? 'UEN' : details.type === 'nric' ? 'NRIC/FIN' : 'mobile'}</dt><dd className="font-mono text-lg font-semibold" data-testid="text-recipient">{formatRecipient(details)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">{details.reference ? referenceLabel(details.type) : 'Reference'}</dt><dd className="text-lg font-semibold break-words" data-testid="text-reference">{details.reference || 'None'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Amount</dt><dd className="font-semibold">{details.amount ? (details.editable ? 'Payer can edit' : 'Fixed') : 'Payer enters it'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Expires</dt><dd className="font-semibold" data-testid="text-expires">{details.expires ? new Date(details.expires).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) + ' SGT' : 'Never'}</dd></div>
        </dl>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {img && !expired ? (
            <a href={img} download={fname} className={`${btn} bg-primary text-primary-foreground hover:bg-[hsl(296_62%_25%)]`} data-testid="button-download"><Download className="h-4 w-4" aria-hidden />Save PNG</a>
          ) : (
            <button disabled className={`${btn} bg-primary/40 text-primary-foreground`} data-testid="button-download"><Download className="h-4 w-4" aria-hidden />Save PNG</button>
          )}
          <button onClick={copy} className={`${btn} bg-accent text-accent-foreground hover:brightness-95`} data-testid="button-copy-url">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={edit} className={`${btn} border border-input bg-card hover:border-primary`} data-testid="button-edit"><Pencil className="h-4 w-4" aria-hidden />Edit</button>
          <a href={BASE} className={`${btn} border border-input bg-card hover:border-primary`} data-testid="button-start-over"><RotateCcw className="h-4 w-4" aria-hidden />Start over</a>
        </div>
        <p className="sr-only" aria-live="polite">{copied ? 'Link copied to clipboard' : ''}</p>

        <div className="mt-8 rounded-2xl bg-secondary/70 p-5 text-sm leading-relaxed text-secondary-foreground">
          <p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" aria-hidden />Before you share</p>
          <p className="mt-2">This link contains the payment details in plain sight, so anyone who has it can read them. Nothing is stored on a server. Bookmark it to reuse it; anyone with the link could also edit its details, so treat the expiry as a convenience, not a lock.</p>
          <p className="mt-2">Payers: your bank app will show the registered recipient name. Check that it matches before you pay. Paynowlah never sees or confirms payments.</p>
        </div>
      </section>
    </div>
  );
}

function BadLink({ message }: { message: string }) {
  return (
    <div className="pn-rise mx-auto max-w-lg pt-16 text-center" role="alert">
      <AlertTriangle className="mx-auto h-10 w-10 text-accent" aria-hidden />
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">This link looks broken</h1>
      <p className="mt-3 text-muted-foreground" data-testid="text-link-error">{message}</p>
      <a href={BASE} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40" data-testid="link-make-new">Make a new one</a>
    </div>
  );
}

/** Payment details live after "#" so they never reach the web server; old "?" links still open. */
function currentQuery(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || window.location.search.replace(/^\?/, '');
}

export default function Home() {
  const [query, setQuery] = useState(currentQuery);
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    if (!window.location.hash && new URLSearchParams(window.location.search).has('recipient')) {
      window.history.replaceState(null, '', `${BASE}#${window.location.search.slice(1)}`);
    }
    const onHash = () => { setQuery(currentQuery()); setVisit((n) => n + 1); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const parsed = useMemo(() => {
    const params = new URLSearchParams(query);
    if (params.has(DRAFT_MARKER)) return { details: null, draft: draftFromParams(params), error: null };
    try {
      return { details: parsePayment(query ? `?${query}` : ''), draft: null, error: null as string | null };
    } catch (e) {
      return { details: null, draft: null, error: errMsg(e) };
    }
  }, [query]);

  return (
    <Shell>
      {parsed.error ? <BadLink message={parsed.error} /> : parsed.details ? <ResultPage key={`${visit}:${query}`} details={parsed.details} /> : <FormPage key={visit} initial={parsed.draft} />}
    </Shell>
  );
}
