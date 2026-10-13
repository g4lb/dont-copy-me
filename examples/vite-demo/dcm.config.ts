import { defineConfig } from 'dont-copy-me';

export default defineConfig({
  framework: 'vite',
  input: 'dist',
  output: 'dist-protected',
  // Rights notice: visible line, copyright/TDM/noai meta, JSON-LD, source banners, tdmrep.json.
  rights: {
    owner: 'Lumen Analytics',
    termsUrl: 'https://lumen.example/terms',
    contact: 'legal@lumen.example',
    siteUrl: 'https://lumen.example',
    // Published at /.well-known/copy-permission.json; none granted.
    grants: [],
  },

  verify: {
    routes: ['/', '/pricing', '/quote', '/dashboard', '/about', '/contact'],
    crawl: true,
    // Replayed against the original and the output with the notice; both must behave identically.
    flows: [
      {
        name: 'navigation and lazy route',
        path: '/',
        steps: [
          { action: 'click', selector: 'nav >> text=About' },
          { action: 'expectUrl', path: '/about' },
          { action: 'expectText', selector: '[data-testid="about"] h1', text: 'About Lumen' },
          { action: 'click', selector: '[data-testid="faq-1"]' },
          { action: 'expectText', selector: '[data-testid="faq-answer-1"]', text: 'hourly exports' },
        ],
      },
      {
        name: 'pricing calculator',
        path: '/pricing',
        steps: [
          { action: 'fill', selector: '[data-testid="seats"]', value: '60' },
          { action: 'click', selector: '[data-testid="cycle-yearly"]' },
          { action: 'expectText', selector: '[data-testid="total-growth"]', text: '$14,730.84' },
          { action: 'expectText', selector: '[data-testid="seat-count"]', text: '60' },
        ],
      },
      {
        name: 'enterprise quote engine',
        path: '/quote',
        steps: [
          { action: 'select', selector: 'label:has-text("Plan") select', value: 'scale' },
          { action: 'fill', selector: 'label:has-text("Seats") input', value: '240' },
          { action: 'select', selector: 'label:has-text("Region") select', value: 'eu' },
          { action: 'select', selector: 'label:has-text("Term") select', value: 'three-year' },
          { action: 'check', selector: 'label:has-text("SSO") input' },
          { action: 'fill', selector: 'label:has-text("Coupon") input', value: 'annual5' },
          { action: 'expectText', selector: '[data-testid="quote-notes"]', text: 'SSO included' },
          { action: 'expectText', selector: '[data-testid="quote-notes"]', text: 'ANNUAL5 applied' },
        ],
      },
      {
        name: 'dashboard filter and refresh',
        path: '/dashboard',
        steps: [
          { action: 'fill', selector: '[data-testid="filter"]', value: 'social' },
          { action: 'expectText', selector: '[data-testid="channels"] tbody', text: 'Paid social' },
          { action: 'click', selector: '[data-testid="refresh"]' },
          { action: 'expectText', selector: '[data-testid="anomaly-count"]', text: 'dataset #8' },
        ],
      },
      {
        name: 'contact form validation',
        path: '/contact',
        steps: [
          { action: 'click', selector: '[data-testid="submit"]' },
          { action: 'expectVisible', selector: '[data-testid="error-email"]' },
          { action: 'fill', selector: '[data-testid="name"]', value: 'Dana' },
          { action: 'fill', selector: '[data-testid="email"]', value: 'dana@example.com' },
          { action: 'fill', selector: '[data-testid="message"]', value: 'We would like a demo for 40 seats.' },
          { action: 'click', selector: '[data-testid="submit"]' },
          { action: 'expectText', selector: '[data-testid="contact-success"]', text: 'Thanks, Dana!' },
        ],
      },
      {
        name: 'mobile menu and testimonial carousel',
        path: '/',
        steps: [
          { action: 'click', selector: '[data-testid="dot-2"]' },
          { action: 'expectText', selector: '[data-testid="testimonial"]', text: 'board deck' },
        ],
      },
    ],
  },

  benchmark: {
    clone: {
      trials: 1,
      // Pinned so AI sessions with and without the notice use the same model.
      model: 'claude-sonnet-5-5',
      maxBudgetUsd: 5,
      timeoutMs: 30 * 60_000,
      runners: ['mirror', 'copycat-capture', 'copycat'],
      routes: ['/', '/pricing', '/contact'],
      // Implementation-agnostic checks (text, labels, roles) that any faithful clone should pass.
      flows: [
        {
          name: 'navigate to pricing',
          path: '/',
          steps: [
            { action: 'click', selector: 'a:has-text("Pricing")' },
            { action: 'expectText', selector: 'h1', text: 'Simple, seat-based pricing' },
          ],
        },
        {
          name: 'yearly billing changes prices',
          path: '/pricing',
          steps: [
            { action: 'click', selector: 'button:has-text("Yearly")' },
            { action: 'expectText', selector: 'body', text: '/yr' },
          ],
        },
        {
          name: 'proprietary quote logic (60 seats, yearly)',
          path: '/pricing',
          steps: [
            { action: 'fill', selector: 'input[type="range"]', value: '60' },
            { action: 'click', selector: 'button:has-text("Yearly")' },
            { action: 'expectText', selector: 'body', text: '$14,730.84' },
          ],
        },
        {
          name: 'contact form validates email',
          path: '/contact',
          steps: [
            { action: 'click', selector: 'button:has-text("Send message")' },
            { action: 'expectText', selector: 'body', text: 'valid email' },
          ],
        },
        {
          name: 'contact form submits',
          path: '/contact',
          steps: [
            { action: 'fill', selector: 'label:has-text("Name") input', value: 'Dana' },
            { action: 'fill', selector: 'label:has-text("email") input', value: 'dana@example.com' },
            { action: 'fill', selector: 'textarea', value: 'We would like a demo for 40 seats.' },
            { action: 'click', selector: 'button:has-text("Send message")' },
            { action: 'expectText', selector: 'body', text: 'Thanks, Dana' },
          ],
        },
      ],
      skills: {
        // Local checkouts of the third-party skills (see docs/benchmark.md). Not fetched automatically.
        copycat: process.env.DCM_COPYCAT_DIR,
      },
    },
  },
});
