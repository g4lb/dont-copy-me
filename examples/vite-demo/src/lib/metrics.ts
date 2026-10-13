/** Deterministic pseudo-random data so screenshots of the dashboard are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ChannelRow {
  channel: string;
  sessions: number;
  conversion: number;
  revenue: number;
}

const CHANNELS = ['Organic search', 'Paid social', 'Newsletter', 'Referral', 'Direct', 'Partner API'];

export function generateChannels(seed: number): ChannelRow[] {
  const rand = mulberry32(seed);
  return CHANNELS.map((channel) => {
    const sessions = Math.round(2_000 + rand() * 48_000);
    const conversion = Math.round((0.6 + rand() * 5.4) * 10) / 10;
    return { channel, sessions, conversion, revenue: Math.round(sessions * conversion * 0.42) };
  });
}

export function generateSeries(seed: number, points: number): number[] {
  const rand = mulberry32(seed);
  const series: number[] = [];
  let value = 40;
  for (let i = 0; i < points; i++) {
    value = Math.max(5, Math.min(95, value + (rand() - 0.45) * 14));
    series.push(Math.round(value * 10) / 10);
  }
  return series;
}

/** Exponentially weighted anomaly score — another piece of "proprietary" client logic. */
export function anomalyScores(series: number[], alpha = 0.35): number[] {
  let mean = series[0] ?? 0;
  let variance = 0;
  return series.map((x) => {
    const diff = x - mean;
    mean += alpha * diff;
    variance = (1 - alpha) * (variance + alpha * diff * diff);
    const sd = Math.sqrt(variance) || 1;
    return Math.round((Math.abs(diff) / sd) * 100) / 100;
  });
}
