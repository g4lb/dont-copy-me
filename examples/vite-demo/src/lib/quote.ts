/**
 * Enterprise quote engine: the demo's "hard" proprietary logic. Several rules interact and some
 * cannot be inferred from a few observations (graduated tiers, caps, plan-specific exceptions,
 * coupon codes that exist only in code).
 */
export type PlanId = 'starter' | 'growth' | 'scale';
export type RegionId = 'us' | 'eu' | 'uk' | 'apac';
export type TermId = 'monthly' | 'annual' | 'three-year';

export interface QuoteInput {
  plan: PlanId;
  seats: number;
  region: RegionId;
  term: TermId;
  /** Extra events per month, in thousands, above the plan allowance. */
  extraEventsK: number;
  sso: boolean;
  audit: boolean;
  priority: boolean;
  coupon: string;
}

export interface QuoteLine {
  label: string;
  amount: number;
}

export interface QuoteResult {
  lines: QuoteLine[];
  total: number;
  monthlyEquivalent: number;
  currency: string;
  notes: string[];
}

const SEAT_PRICE: Record<PlanId, number> = { starter: 12, growth: 29, scale: 59 };
const OVERAGE_PER_10K: Record<PlanId, number> = { starter: 4, growth: 2.5, scale: 1.2 };
const REGIONS: Record<RegionId, { currency: string; fx: number; tax: number }> = {
  us: { currency: 'USD', fx: 1, tax: 0 },
  eu: { currency: 'EUR', fx: 0.92, tax: 0.21 },
  uk: { currency: 'GBP', fx: 0.79, tax: 0.2 },
  apac: { currency: 'SGD', fx: 1.34, tax: 0.09 },
};
const TERM_MONTHS: Record<TermId, number> = { monthly: 1, annual: 12, 'three-year': 36 };

/** Graduated pricing: each band of seats is priced at its own rate. */
const SEAT_BANDS: Array<[upTo: number, factor: number]> = [
  [10, 1],
  [50, 0.92],
  [200, 0.85],
  [Infinity, 0.78],
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function seatCost(plan: PlanId, seats: number): number {
  let remaining = seats;
  let previous = 0;
  let cost = 0;
  for (const [upTo, factor] of SEAT_BANDS) {
    const inBand = Math.min(remaining, upTo - previous);
    if (inBand <= 0) break;
    cost += inBand * SEAT_PRICE[plan] * factor;
    remaining -= inBand;
    previous = upTo;
  }
  return cost;
}

export function termDiscount(plan: PlanId, term: TermId): number {
  if (term === 'annual') return 0.17;
  if (term === 'three-year') return plan === 'scale' ? 0.3 : 0.26;
  return 0;
}

function couponEffect(code: string, input: QuoteInput): { rate: number; note: string } {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { rate: 0, note: '' };
  if (normalized === 'LUMEN10') return { rate: 0.1, note: 'Coupon LUMEN10 applied' };
  if (normalized === 'STARTUP30') {
    return input.plan === 'starter' && input.seats <= 20
      ? { rate: 0.3, note: 'Coupon STARTUP30 applied' }
      : { rate: 0, note: 'STARTUP30 is only valid for Starter with up to 20 seats' };
  }
  if (normalized === 'ANNUAL5') {
    return input.term === 'monthly' ? { rate: 0, note: 'ANNUAL5 requires annual or three-year billing' } : { rate: 0.05, note: 'Coupon ANNUAL5 applied' };
  }
  return { rate: 0, note: 'Invalid coupon code' };
}

export function computeQuote(input: QuoteInput): QuoteResult {
  const seats = Math.max(1, Math.min(1000, Math.round(input.seats) || 1));
  const months = TERM_MONTHS[input.term];
  const region = REGIONS[input.region];
  const notes: string[] = [];

  const seatsMonthly = seatCost(input.plan, seats);
  const overageMonthly = Math.ceil(Math.max(0, input.extraEventsK) / 10) * OVERAGE_PER_10K[input.plan];

  let addonsMonthly = 0;
  if (input.sso) {
    if (seats >= 200 || input.plan === 'scale') notes.push('SSO included');
    else addonsMonthly += seats * 3;
  }
  if (input.audit) {
    if (input.plan === 'starter') notes.push('Audit log requires Growth or Scale');
    else addonsMonthly += 150;
  }
  if (input.priority) {
    addonsMonthly += Math.min(1500, Math.max(99, (seatsMonthly + overageMonthly) * 0.08));
  }

  const subscription = (seatsMonthly + overageMonthly) * months;
  const termRate = termDiscount(input.plan, input.term);
  const coupon = couponEffect(input.coupon, { ...input, seats });
  if (coupon.note) notes.push(coupon.note);
  // Coupons stack multiplicatively with the term discount and never apply to add-ons.
  const discount = subscription * (1 - (1 - termRate) * (1 - coupon.rate));
  const addons = addonsMonthly * months;

  const toLocal = (usd: number): number => round2(usd * region.fx);
  const lines: QuoteLine[] = [
    { label: 'Seats', amount: toLocal(seatsMonthly * months) },
    { label: 'Event overage', amount: toLocal(overageMonthly * months) },
    { label: 'Add-ons', amount: toLocal(addons) },
    { label: 'Discounts', amount: -toLocal(discount) },
  ];
  const net = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const tax = round2(net * region.tax);
  lines.push({ label: 'Tax', amount: tax });
  const total = round2(net + tax);
  return { lines, total, monthlyEquivalent: round2(total / months), currency: region.currency, notes };
}

export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
