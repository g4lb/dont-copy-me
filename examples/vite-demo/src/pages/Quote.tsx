import { useMemo, useState } from 'react';
import { computeQuote, formatAmount, type PlanId, type QuoteInput, type RegionId, type TermId } from '../lib/quote';

const INITIAL: QuoteInput = { plan: 'growth', seats: 25, region: 'us', term: 'annual', extraEventsK: 0, sso: false, audit: false, priority: false, coupon: '' };

export function Quote() {
  const [input, setInput] = useState<QuoteInput>(INITIAL);
  const quote = useMemo(() => computeQuote(input), [input]);
  const set = <K extends keyof QuoteInput>(key: K, value: QuoteInput[K]): void => setInput((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="section">
      <h1>Build an enterprise quote</h1>
      <p className="lead">Graduated seat pricing, usage overage, regional tax and add-ons, computed instantly.</p>
      <div className="quote-grid">
        <form className="form card" onSubmit={(e) => e.preventDefault()} aria-label="Quote options">
          <label>
            Plan
            <select value={input.plan} onChange={(e) => set('plan', e.target.value as PlanId)}>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="scale">Scale</option>
            </select>
          </label>
          <label>
            Seats
            <input type="number" min={1} max={1000} value={input.seats} onChange={(e) => set('seats', Number(e.target.value))} />
          </label>
          <label>
            Region
            <select value={input.region} onChange={(e) => set('region', e.target.value as RegionId)}>
              <option value="us">United States (USD)</option>
              <option value="eu">European Union (EUR)</option>
              <option value="uk">United Kingdom (GBP)</option>
              <option value="apac">Singapore (SGD)</option>
            </select>
          </label>
          <label>
            Term
            <select value={input.term} onChange={(e) => set('term', e.target.value as TermId)}>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="three-year">Three years</option>
            </select>
          </label>
          <label>
            Extra events per month (thousands)
            <input type="number" min={0} step={1} value={input.extraEventsK} onChange={(e) => set('extraEventsK', Number(e.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={input.sso} onChange={(e) => set('sso', e.target.checked)} /> SSO
          </label>
          <label className="check">
            <input type="checkbox" checked={input.audit} onChange={(e) => set('audit', e.target.checked)} /> Audit log
          </label>
          <label className="check">
            <input type="checkbox" checked={input.priority} onChange={(e) => set('priority', e.target.checked)} /> Priority support
          </label>
          <label>
            Coupon code
            <input value={input.coupon} onChange={(e) => set('coupon', e.target.value)} placeholder="Optional" />
          </label>
        </form>
        <div className="card" aria-label="Quote summary" data-testid="quote-summary">
          <h2>Your quote</h2>
          <dl className="quote-lines">
            {quote.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{formatAmount(line.amount, quote.currency)}</dd>
              </div>
            ))}
          </dl>
          <p className="price" data-testid="quote-total">
            {formatAmount(quote.total, quote.currency)}
          </p>
          <p className="muted" data-testid="quote-monthly">
            {formatAmount(quote.monthlyEquivalent, quote.currency)} per month equivalent
          </p>
          {quote.notes.length ? (
            <ul className="quote-notes" data-testid="quote-notes">
              {quote.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
