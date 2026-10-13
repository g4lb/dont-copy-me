import { useState } from 'react';

const FAQ = [
  { q: 'Where is my data stored?', a: 'In the region you choose at signup: EU, US or APAC.' },
  { q: 'Can I export raw events?', a: 'Yes. Every plan includes hourly exports to your own bucket.' },
  { q: 'Do you offer a free trial?', a: 'Every plan starts with a 14-day trial, no card required.' },
];

export default function About() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section narrow" data-testid="about">
      <h1>About Lumen</h1>
      <p className="lead">We are a small team obsessed with turning noisy data into clear decisions.</p>
      <div className="faq">
        {FAQ.map((item, i) => (
          <div key={item.q} className={open === i ? 'faq-item open' : 'faq-item'}>
            <button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} data-testid={`faq-${i}`}>
              {item.q}
            </button>
            {open === i ? <p data-testid={`faq-answer-${i}`}>{item.a}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
