import { useMemo, useState } from 'react';
import { anomalyScores, generateChannels, generateSeries, type ChannelRow } from '../lib/metrics';

type SortKey = keyof Pick<ChannelRow, 'sessions' | 'conversion' | 'revenue'>;

function Sparkline({ series, flagged }: { series: number[]; flagged: Set<number> }) {
  const width = 640;
  const height = 160;
  const step = width / Math.max(1, series.length - 1);
  const points = series.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / 100) * height).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Active users over the last 30 days">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      {series.map((v, i) =>
        flagged.has(i) ? <circle key={i} cx={i * step} cy={height - (v / 100) * height} r="6" className="anomaly" /> : null,
      )}
    </svg>
  );
}

export function Dashboard() {
  const [seed, setSeed] = useState(7);
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [query, setQuery] = useState('');
  const series = useMemo(() => generateSeries(seed, 30), [seed]);
  const flagged = useMemo(() => {
    const scores = anomalyScores(series);
    return new Set(scores.flatMap((s, i) => (s > 1.8 ? [i] : [])));
  }, [series]);
  const rows = useMemo(
    () =>
      generateChannels(seed)
        .filter((r) => r.channel.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => b[sortKey] - a[sortKey]),
    [seed, sortKey, query],
  );
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);

  return (
    <section className="section">
      <div className="dash-head">
        <h1>Live demo dashboard</h1>
        <button className="button ghost" onClick={() => setSeed((s) => s + 1)} data-testid="refresh">
          Refresh data
        </button>
      </div>
      <div className="card">
        <h2>Active users</h2>
        <p className="muted" data-testid="anomaly-count">
          {flagged.size} anomal{flagged.size === 1 ? 'y' : 'ies'} detected · dataset #{seed}
        </p>
        <Sparkline series={series} flagged={flagged} />
      </div>
      <div className="card">
        <div className="table-tools">
          <label>
            Filter channels
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. social" data-testid="filter" />
          </label>
          <label>
            Sort by
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} data-testid="sort">
              <option value="revenue">Revenue</option>
              <option value="sessions">Sessions</option>
              <option value="conversion">Conversion</option>
            </select>
          </label>
        </div>
        <table data-testid="channels">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Sessions</th>
              <th scope="col">Conversion</th>
              <th scope="col">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel}>
                <td>{r.channel}</td>
                <td>{r.sessions.toLocaleString('en-US')}</td>
                <td>{r.conversion}%</td>
                <td>${r.revenue.toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" data-testid="total-revenue">
          Total revenue: ${totalRevenue.toLocaleString('en-US')}
        </p>
      </div>
    </section>
  );
}
