import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, Download, Link2, Pencil, RotateCcw, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import {
  parsePayment,
  validatePayment,
  buildPaymentParams,
  formatRecipient,
  isExpired,
  type PaymentDetails,
} from '@/lib/paynow';
import { renderPaymentImage } from '@/lib/qr-image';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/';

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Something in those details does not look right.';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pn-grain min-h-[100dvh] relative overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-accent/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-72 -left-40 h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
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

type ExpiryUnit = 'none' | 'hours' | 'days' | 'keep';

function GeneratorForm({ initial }: { initial?: PaymentDetails | null }) {
  const [type, setType] = useState<'mobile' | 'uen'>(initial?.type ?? 'mobile');
  const [recipient, setRecipient] = useState(initial?.recipient ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [editable, setEditable] = useState(initial ? initial.editable : false);
  const [unit, setUnit] = useState<ExpiryUnit>(initial?.expires ? 'keep' : 'none');
  const [count, setCount] = useState('24');
  const [error, setError] = useState<string | null>(null);

  const nonAscii = /[^\x20-\x7E]/.test(reference);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let expires: number | undefined;
    if (unit === 'keep') expires = initial?.expires;
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
      const params = buildPaymentParams(details);
      window.location.assign(`${BASE}?${params.toString()}`);
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
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(['mobile', 'uen'] as const).map((t) => (
            <label key={t} className={`cursor-pointer rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${type === t ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" data-testid={`radio-type-${t}`} />
              {t === 'mobile' ? 'Mobile number' : 'Business UEN'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-5">
        <label htmlFor="recipient" className={label}>{type === 'mobile' ? 'Mobile number' : 'UEN'}</label>
        <input id="recipient" name="recipient" required value={recipient} onChange={(e) => setRecipient(e.target.value)} inputMode={type === 'mobile' ? 'tel' : 'text'} autoComplete={type === 'mobile' ? 'tel' : 'off'} placeholder={type === 'mobile' ? '9123 4567' : '201912345K'} className={`${field} font-mono`} data-testid="input-recipient" />
      </div>

      <div className="mb-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reference" className={label}>Reference <span className="font-normal text-muted-foreground">(optional)</span></label>
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
            {initial?.expires && <option value="keep">Keep current ({new Date(initial.expires).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) + ' SGT'})</option>}
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

function DemoCard() {
  return (
    <div aria-hidden className="pn-pop relative mx-auto w-full max-w-[19rem] rotate-[3deg] rounded-[1.6rem] bg-primary p-5 text-primary-foreground shadow-[0_40px_70px_-30px_hsl(296_62%_25%/0.7)]" style={{ animationDelay: '.15s' }}>
      <span className="absolute -top-3 right-5 rounded-full bg-accent px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest">Demo only</span>
      <div className="rounded-2xl bg-card p-4">
        <div className="relative grid aspect-square grid-cols-9 gap-1 opacity-80">
          {Array.from({ length: 81 }).map((_, i) => (
            <span key={i} className={`rounded-[3px] ${[0, 1, 2, 9, 11, 18, 19, 20, 6, 7, 8, 15, 17, 24, 25, 26, 54, 55, 56, 63, 65, 72, 73, 74, 31, 41, 49, 33, 58, 69, 78, 44, 52].includes(i) ? 'bg-primary' : 'bg-secondary'}`} />
          ))}
          <span className="absolute inset-0 m-auto grid h-14 w-14 place-items-center rounded-xl bg-card text-[11px] font-extrabold text-primary ring-4 ring-card">Pay<span className="-mt-3 text-accent">Now</span></span>
        </div>
      </div>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-widest opacity-70">Not a real code</p>
      <p className="text-2xl font-extrabold">SGD 18.40</p>
      <p className="text-sm opacity-80">Chicken rice, Tuesday lunch</p>
    </div>
  );
}

function FormPage({ initial }: { initial?: PaymentDetails | null }) {
  return (
    <div className="grid items-start gap-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-12">
      <section className="pn-rise">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">PayNow QR, in one link</p>
        <h1 className="mt-3 text-[clamp(2.5rem,7vw,4.6rem)] font-extrabold leading-[0.95] tracking-tight">
          {initial ? 'Tweak it, then' : 'Pay & Get Paid'}
          <span className={`block text-primary ${initial ? '' : 'mt-4 text-[clamp(1.25rem,3vw,1.75rem)] font-bold leading-snug tracking-normal'}`}>{initial ? 'share again.' : 'Correctly & easily with a prefilled Paynow QR'}</span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-muted-foreground">Correct amount. Correct reference text. Save into Photos app for reuse.</p>
        <div className="mt-10 hidden lg:block"><DemoCard /></div>
        <ul className="mt-10 hidden gap-3 text-sm lg:grid">
          <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />Your details live only in the link and your browser.</li>
          <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />The payer&rsquo;s bank app shows the real recipient name before they pay.</li>
        </ul>
      </section>
      <GeneratorForm initial={initial} />
    </div>
  );
}

function ResultPage({ details }: { details: PaymentDetails }) {
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [, tick] = useState(0);
  const expired = isExpired(details);
  useEffect(() => {
    if (!details.expires || expired) return;
    const ms = Math.min(details.expires - Date.now() + 50, 2_000_000_000);
    const t = setTimeout(() => { setImg(null); tick((n) => n + 1); }, Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [details, expired]);
  const url = typeof window !== 'undefined' ? window.location.href : '';

  useEffect(() => {
    if (expired) return;
    let alive = true;
    setImg(null);
    setImgErr(null);
    renderPaymentImage(details).then((d) => alive && setImg(d)).catch((e) => alive && setImgErr(errMsg(e)));
    return () => { alive = false; };
  }, [details, expired]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const t = document.createElement('textarea');
      t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (editing) {
    return (
      <div>
        <button onClick={() => setEditing(false)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="button-cancel-edit"><ArrowLeft className="h-4 w-4" aria-hidden />Back to QR</button>
        <FormPage initial={details} />
      </div>
    );
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
        <h1 className="mt-2 text-[clamp(2.2rem,6vw,3.8rem)] font-extrabold leading-none tracking-tight" data-testid="text-amount">
          {details.amount ? <>SGD {details.amount}</> : 'Any amount'}
        </h1>
        <dl className="mt-6 grid gap-x-8 gap-y-4 border-y border-border py-5 sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">To {details.type === 'uen' ? 'UEN' : 'mobile'}</dt><dd className="font-mono text-lg font-semibold" data-testid="text-recipient">{formatRecipient(details)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Reference</dt><dd className="text-lg font-semibold break-words" data-testid="text-reference">{details.reference || 'None'}</dd></div>
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
          <button onClick={() => setEditing(true)} className={`${btn} border border-input bg-card hover:border-primary`} data-testid="button-edit"><Pencil className="h-4 w-4" aria-hidden />Edit</button>
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

export default function Home() {
  const search = window.location.search;
  const parsed = useMemo(() => {
    try {
      return { details: parsePayment(search ? `?${search.replace(/^\?/, '')}` : ''), error: null as string | null };
    } catch (e) {
      return { details: null, error: errMsg(e) };
    }
  }, [search]);

  return (
    <Shell>
      {parsed.error ? <BadLink message={parsed.error} /> : parsed.details ? <ResultPage details={parsed.details} /> : <FormPage />}
    </Shell>
  );
}
