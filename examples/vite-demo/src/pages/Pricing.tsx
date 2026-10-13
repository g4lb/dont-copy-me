import { useMemo, useState } from 'react';
import { formatMoney, PLANS, quote, type BillingCycle } from '../lib/pricing';

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [seats, setSeats] = useState(10);
  const quotes = useMemo(() => PLANS.map((plan) => quote(plan, seats, cycle)), [seats, cycle]);
  return (
    <section className="section">
      <h1>Simple, seat-based pricing</h1>
      <p className="lead">Volume discounts apply automatically. Yearly billing saves 17%.</p>

      <div className="controls">
        <div className="toggle" role="radiogroup" aria-label="Billing cycle">
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={cycle === c}
              className={cycle === c ? 'active' : undefined}
              onClick={() => setCycle(c)}
              data-testid={`cycle-${c}`}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
        <label className="seats">
          Seats: <output data-testid="seat-count">{seats}</output>
          <input
            type="range"
            min={1}
            max={150}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            data-testid="seats"
          />
        </label>
      </div>

      <div className="grid three">
        {quotes.map((q) => (
          <article key={q.plan.id} className={q.plan.id === 'growth' ? 'card plan featured' : 'card plan'} data-testid={`plan-${q.plan.id}`}>
            <h2>{q.plan.name}</h2>
            <p className="price" data-testid={`total-${q.plan.id}`}>
              {formatMoney(q.total)}
              <small>/{cycle === 'yearly' ? 'yr' : 'mo'}</small>
            </p>
            <p className="muted">
              {formatMoney(q.perSeat)} per seat per month · {Math.round(q.discount * 100)}% off
            </p>
            <ul>
              {q.plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
              <li>{q.plan.includedEvents.toLocaleString('en-US')} events / month</li>
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
