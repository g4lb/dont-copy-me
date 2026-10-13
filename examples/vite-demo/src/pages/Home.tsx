import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/Link';

const FEATURES = [
  { title: 'Live funnels', body: 'Watch conversion move in real time with sub-second ingestion.' },
  { title: 'Anomaly radar', body: 'Adaptive baselines flag unusual traffic before it costs you.' },
  { title: 'Privacy first', body: 'Cookieless measurement with regional data residency.' },
];

const TESTIMONIALS = [
  { quote: 'Lumen replaced three tools and our weekly report now writes itself.', who: 'Dana, Head of Growth' },
  { quote: 'The anomaly alerts caught a broken checkout within minutes.', who: 'Ari, Staff Engineer' },
  { quote: 'Our board deck is just a Lumen dashboard now.', who: 'Noa, COO' },
];

function Counter({ to }: { to: number }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Count up once visible; jumps straight to the final value when motion is reduced.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / 900);
      setValue(Math.round(to * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return <span ref={ref}>{value.toLocaleString('en-US')}</span>;
}

export function Home() {
  const [index, setIndex] = useState(0);
  const testimonial = TESTIMONIALS[index] ?? TESTIMONIALS[0]!;
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Product analytics, without the guesswork</p>
          <h1>See every signal. Act before your competitors do.</h1>
          <p className="lead">Lumen turns raw product events into decisions your whole team trusts.</p>
          <div className="cta-row">
            <Link to="/pricing" className="button primary">
              See pricing
            </Link>
            <Link to="/dashboard" className="button ghost">
              Try the live demo
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb" />
          <div className="orb second" />
        </div>
      </section>

      <section className="section stats" aria-label="Key numbers">
        <div>
          <strong>
            <Counter to={12800} />
          </strong>
          <span>teams onboarded</span>
        </div>
        <div>
          <strong>
            <Counter to={420} />M
          </strong>
          <span>events per day</span>
        </div>
        <div>
          <strong>
            <Counter to={99} />.98%
          </strong>
          <span>uptime last year</span>
        </div>
      </section>

      <section className="section">
        <h2>Why teams switch to Lumen</h2>
        <div className="grid three">
          {FEATURES.map((f) => (
            <article key={f.title} className="card reveal">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section narrow testimonial" aria-live="polite">
        <blockquote data-testid="testimonial">“{testimonial.quote}”</blockquote>
        <p className="muted">— {testimonial.who}</p>
        <div className="dots" role="tablist" aria-label="Testimonials">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.who}
              role="tab"
              aria-selected={i === index}
              aria-label={`Show testimonial ${i + 1}`}
              className={i === index ? 'dot active' : 'dot'}
              onClick={() => setIndex(i)}
              data-testid={`dot-${i}`}
            />
          ))}
        </div>
      </section>
    </>
  );
}
