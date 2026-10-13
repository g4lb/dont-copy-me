/**
 * The "secret sauce" of the demo product: a proprietary quote engine.
 */
export type BillingCycle = 'monthly' | 'yearly';

export interface Plan {
  id: 'starter' | 'growth' | 'scale';
  name: string;
  seatPrice: number;
  includedEvents: number;
  features: string[];
}

export const PLANS: Plan[] = [
  { id: 'starter', name: 'Starter', seatPrice: 12, includedEvents: 50_000, features: ['3 dashboards', 'Email reports', '7-day retention'] },
  { id: 'growth', name: 'Growth', seatPrice: 29, includedEvents: 500_000, features: ['Unlimited dashboards', 'Anomaly alerts', '90-day retention'] },
  { id: 'scale', name: 'Scale', seatPrice: 59, includedEvents: 5_000_000, features: ['SSO & audit log', 'Custom models', '2-year retention'] },
];

const VOLUME_TIERS: Array<[seats: number, discount: number]> = [
  [100, 0.22],
  [50, 0.15],
  [20, 0.08],
  [10, 0.04],
];

export function volumeDiscount(seats: number): number {
  for (const [threshold, discount] of VOLUME_TIERS) {
    if (seats >= threshold) return discount;
  }
  return 0;
}

export interface Quote {
  plan: Plan;
  seats: number;
  cycle: BillingCycle;
  subtotal: number;
  discount: number;
  total: number;
  perSeat: number;
}

export function quote(plan: Plan, seats: number, cycle: BillingCycle): Quote {
  const safeSeats = Math.max(1, Math.min(500, Math.round(seats)));
  const months = cycle === 'yearly' ? 12 : 1;
  const subtotal = plan.seatPrice * safeSeats * months;
  const cycleDiscount = cycle === 'yearly' ? 0.17 : 0;
  const discount = 1 - (1 - volumeDiscount(safeSeats)) * (1 - cycleDiscount);
  const total = Math.round(subtotal * (1 - discount) * 100) / 100;
  return { plan, seats: safeSeats, cycle, subtotal, discount, total, perSeat: Math.round((total / safeSeats / months) * 100) / 100 };
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
