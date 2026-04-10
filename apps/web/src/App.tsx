import { useEffect, useMemo, useState } from 'react';
import {
  addTotals,
  emptyTotals,
  sortModelUsage,
  type DashboardData,
  type DailyUsage,
  type ProviderId,
  type ProviderSnapshot,
  type TokenTotals,
  type UserAggregate,
} from '@sloparena/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'https://usageboard-api-production.up.railway.app';
const providers: Array<ProviderId | 'all'> = ['all', 'claude', 'codex'];
const metrics = ['total', 'input', 'output', 'cache'] as const;

type MetricKey = (typeof metrics)[number];
type ThemeKey = 'dark' | 'light';

interface LeaderboardRow {
  user: UserAggregate;
  id: string;
  rank: number;
  displayName: string;
  githubHandle: string;
  githubUrl: string;
  xHandle?: string;
  xUrl?: string;
  avatarUrl?: string;
  machines: number;
  activityDays: number;
  lastSubmitted: string;
  topModel: string;
  metricValue: number;
  totals: TokenTotals;
  summary: ProviderSnapshot;
}

function metricValue(totals: TokenTotals, metric: MetricKey): number {
  return totals[metric];
}

function mergeProviders(items: ProviderSnapshot[]): ProviderSnapshot {
  const totals = emptyTotals();
  const modelMap = new Map<string, TokenTotals>();
  const dayMap = new Map<string, { totals: TokenTotals; models: Map<string, TokenTotals>; displayValue: number }>();
  let sourceCount = 0;

  for (const item of items) {
    addTotals(totals, item.totals);
    sourceCount += item.sourceCount;

    for (const model of item.byModel) {
      const current = modelMap.get(model.model) ?? emptyTotals();
      addTotals(current, model.tokens);
      modelMap.set(model.model, current);
    }

    for (const day of item.byDay) {
      const currentDay = dayMap.get(day.date) ?? {
        totals: emptyTotals(),
        models: new Map<string, TokenTotals>(),
        displayValue: 0,
      };

      addTotals(currentDay.totals, day.totals);
      currentDay.displayValue += day.displayValue ?? 0;

      for (const model of day.models) {
        const currentModel = currentDay.models.get(model.model) ?? emptyTotals();
        addTotals(currentModel, model.tokens);
        currentDay.models.set(model.model, currentModel);
      }

      dayMap.set(day.date, currentDay);
    }
  }

  const byDay: DailyUsage[] = [...dayMap.entries()]
    .map(([date, value]) => ({
      date,
      totals: value.totals,
      models: sortModelUsage([...value.models.entries()].map(([model, tokens]) => ({ model, tokens }))),
      displayValue: value.displayValue > 0 ? value.displayValue : undefined,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    provider: 'claude',
    totals,
    byModel: sortModelUsage([...modelMap.entries()].map(([model, tokens]) => ({ model, tokens }))),
    byDay,
    sourceCount,
    activityDays: byDay.filter((day) => day.totals.total > 0 || day.displayValue).length,
  };
}

function pickProvider(user: UserAggregate, provider: ProviderId | 'all'): ProviderSnapshot | null {
  if (provider === 'all') {
    return user.providers.length > 0 ? mergeProviders(user.providers) : null;
  }
  return user.providers.find((item) => item.provider === provider) ?? null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function githubHandleToUrl(handle: string): string {
  return `https://github.com/${handle.replace(/^@/, '')}`;
}

function xHandleToUrl(handle?: string): string | undefined {
  if (!handle) {
    return undefined;
  }
  return `https://x.com/${handle.replace(/^@/, '')}`;
}

function getThemePreference(): ThemeKey {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const saved = window.localStorage.getItem('sloparena-theme');
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function rankTone(rank: number): string {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return 'plain';
}

function rankGlyph(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function providerTone(provider: ProviderId): string {
  return provider === 'claude' ? 'var(--claude)' : 'var(--codex)';
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeKey; onToggle: () => void }) {
  return (
    <button type="button" className="utility-button" onClick={onToggle}>
      <span className="utility-icon">{theme === 'dark' ? '◐' : '◑'}</span>
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button type="button" className="refresh-button" onClick={onClick} disabled={loading}>
      <span className={`refresh-wheel${loading ? ' spinning' : ''}`}>↻</span>
      {loading ? 'Refreshing…' : 'Refresh board'}
    </button>
  );
}

function Avatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    return <img className="avatar" src={url} alt={name} referrerPolicy="no-referrer" />;
  }

  return <div className="avatar avatar-fallback">{name.slice(0, 1).toUpperCase()}</div>;
}

function HandleCluster({ githubHandle, githubUrl, xHandle, xUrl }: { githubHandle: string; githubUrl: string; xHandle?: string; xUrl?: string }) {
  return (
    <div className="handle-cluster">
      <a href={githubUrl} target="_blank" rel="noreferrer" className="handle-pill github">
        {githubHandle}
      </a>
      {xHandle && xUrl ? (
        <a href={xUrl} target="_blank" rel="noreferrer" className="handle-pill x">
          @{xHandle}
        </a>
      ) : null}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const [metric, setMetric] = useState<MetricKey>('total');
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [theme, setTheme] = useState<ThemeKey>(getThemePreference);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('sloparena-theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`${API_URL}/api/dashboard`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load dashboard (${response.status})`);
        }

        const payload = (await response.json()) as DashboardData;
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error && loadError.name === 'AbortError'
            ? 'The board took too long to answer. Try refreshing it again.'
            : loadError instanceof Error
              ? loadError.message
              : String(loadError);
          setError(message);
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [reloadTick]);

  const leaderboardRows = useMemo<LeaderboardRow[]>(() => {
    if (!data) {
      return [];
    }

    return data.users
      .map((user) => {
        const summary = pickProvider(user, provider);
        if (!summary) {
          return null;
        }

        return {
          user,
          id: user.userId,
          rank: 0,
          displayName: user.profile.displayName,
          githubHandle: `@${user.profile.handle}`,
          githubUrl: user.profile.profileUrl || githubHandleToUrl(user.profile.handle),
          xHandle: user.profile.xHandle,
          xUrl: xHandleToUrl(user.profile.xHandle),
          avatarUrl: user.profile.avatarUrl,
          machines: user.machines,
          activityDays: summary.activityDays,
          lastSubmitted: user.lastSubmitted,
          topModel: summary.byModel[0]?.model ?? 'No model fingerprint yet',
          metricValue: metricValue(summary.totals, metric),
          totals: summary.totals,
          summary,
        };
      })
      .filter((row): row is LeaderboardRow => Boolean(row))
      .filter((row) => `${row.displayName} ${row.githubHandle} ${row.xHandle ?? ''} ${row.topModel}`.toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => right.metricValue - left.metricValue || right.totals.total - left.totals.total || left.displayName.localeCompare(right.displayName))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, [data, metric, provider, query]);

  useEffect(() => {
    if (!leaderboardRows.length) {
      setSelectedUserId(null);
      return;
    }

    if (!selectedUserId || !leaderboardRows.some((row) => row.id === selectedUserId)) {
      setSelectedUserId(leaderboardRows[0].id);
    }
  }, [leaderboardRows, selectedUserId]);

  const selectedRow = useMemo(
    () => leaderboardRows.find((row) => row.id === selectedUserId) ?? leaderboardRows[0] ?? null,
    [leaderboardRows, selectedUserId],
  );

  const maxMetric = leaderboardRows[0]?.metricValue ?? 1;
  const generatedAt = data?.generatedAt ? formatDate(data.generatedAt) : '—';
  const totalUsage = useMemo(() => {
    if (!data) {
      return emptyTotals();
    }

    return data.users.reduce((sum, user) => {
      const summary = pickProvider(user, provider);
      if (summary) {
        addTotals(sum, summary.totals);
      }
      return sum;
    }, emptyTotals());
  }, [data, provider]);

  const selectedProviderMix = useMemo(() => {
    if (!selectedRow) {
      return [] as Array<{ provider: ProviderId; total: number; share: number }>;
    }

    const total = selectedRow.user.providers.reduce((sum, item) => sum + item.totals.total, 0) || 1;
    return selectedRow.user.providers.map((item) => ({
      provider: item.provider,
      total: item.totals.total,
      share: item.totals.total / total,
    }));
  }, [selectedRow]);

  const selectedTokenMix = useMemo(() => {
    if (!selectedRow) {
      return [] as Array<{ label: string; value: number; share: number }>;
    }

    const total = selectedRow.summary.totals.total || 1;
    return [
      { label: 'Input', value: selectedRow.summary.totals.input, share: selectedRow.summary.totals.input / total },
      { label: 'Output', value: selectedRow.summary.totals.output, share: selectedRow.summary.totals.output / total },
      { label: 'Cache', value: selectedRow.summary.totals.cache, share: selectedRow.summary.totals.cache / total },
    ];
  }, [selectedRow]);

  const selectedModels = useMemo(() => {
    if (!selectedRow) {
      return [] as Array<{ model: string; value: number; share: number }>;
    }

    return selectedRow.summary.byModel.slice(0, 6).map((model) => ({
      model: model.model,
      value: metricValue(model.tokens, metric),
      share: selectedRow.metricValue > 0 ? metricValue(model.tokens, metric) / selectedRow.metricValue : 0,
    }));
  }, [metric, selectedRow]);

  const selectedDays = useMemo(() => {
    if (!selectedRow) {
      return [] as Array<{ date: string; value: number; normalized: number; label: string }>;
    }

    const recent = selectedRow.summary.byDay.slice(-12);
    const values = recent.map((day) => metricValue(day.totals, metric) || day.displayValue || 0);
    const max = Math.max(...values, 1);

    return recent.map((day) => {
      const raw = metricValue(day.totals, metric) || day.displayValue || 0;
      const normalized = Math.max(0.12, Math.log10(raw + 1) / Math.log10(max + 1 || 10));
      return {
        date: day.date,
        value: raw,
        normalized,
        label: new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
    });
  }, [metric, selectedRow]);

  const donutStyle = useMemo(() => {
    if (!selectedProviderMix.length) {
      return { background: 'var(--panel-subtle)' };
    }

    if (selectedProviderMix.length === 1) {
      return { background: providerTone(selectedProviderMix[0].provider) };
    }

    const first = selectedProviderMix[0];
    const breakpoint = `${(first.share * 360).toFixed(2)}deg`;
    return {
      background: `conic-gradient(${providerTone(first.provider)} 0deg ${breakpoint}, ${providerTone(selectedProviderMix[1].provider)} ${breakpoint} 360deg)`,
    };
  }, [selectedProviderMix]);

  return (
    <main className="arena-shell">
      <section className="hero-wrap">
        <div className="hero-topline">
          <div className="brand-lockup">
            <span className="brand-badge">✦</span>
            <span className="brand-wordmark">SlopArena</span>
          </div>
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          />
        </div>

        <div className="hero-copy">
          <p className="hero-kicker">verified usage, public shame, immaculate receipts</p>
          <h1>The arena for people who treat terminals like a sport.</h1>
          <p className="hero-body">
            GitHub-verified builders publish 365-day Claude Code and Codex snapshots from the CLI. No fake dashboards. No hand-entered vanity numbers. Just local logs, ranked in public.
          </p>
        </div>

        <div className="command-rack">
          <label className="command-search">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search @handle, x handle, or model'
              aria-label="Search leaderboard"
            />
          </label>

          <div className="hero-actions">
            <RefreshButton loading={loading} onClick={() => setReloadTick((value) => value + 1)} />
            <a className="ghost-action" href="https://www.npmjs.com/package/sloparena" target="_blank" rel="noreferrer">
              See the CLI
            </a>
          </div>
        </div>

        <div className="hero-meta">
          <span>365-day window</span>
          <span>GitHub-verified identity</span>
          <span>Optional X flex</span>
          <span>Last refresh {generatedAt}</span>
        </div>
      </section>

      <section className="filters-row">
        <div className="filter-cluster">
          <span className="cluster-label">Provider</span>
          <div className="segmented-control">
            {providers.map((item) => (
              <button
                key={item}
                type="button"
                className={provider === item ? 'active' : ''}
                onClick={() => setProvider(item)}
              >
                {item === 'all' ? 'All traffic' : item}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-cluster">
          <span className="cluster-label">Metric</span>
          <div className="segmented-control">
            {metrics.map((item) => (
              <button
                key={item}
                type="button"
                className={metric === item ? 'active' : ''}
                onClick={() => setMetric(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="totals-chipline">
          <div className="totals-chip">
            <span>tracked operators</span>
            <strong>{formatNumber(data?.activeUsers ?? 0)}</strong>
          </div>
          <div className="totals-chip">
            <span>machines</span>
            <strong>{formatNumber(data?.activeMachines ?? 0)}</strong>
          </div>
          <div className="totals-chip emphasis">
            <span>{metric}</span>
            <strong>{formatCompactNumber(metricValue(totalUsage, metric))}</strong>
          </div>
        </div>
      </section>

      {error ? (
        <section className="status-banner error-banner">
          <div>{error}</div>
          <button type="button" onClick={() => setReloadTick((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : null}

      <section className="arena-grid">
        <section className="leaderboard-slab">
          <div className="slab-header">
            <div>
              <p className="slab-kicker">leaderboard</p>
              <h2>Top terminal operators</h2>
            </div>
            <p className="slab-note">Click a row to inspect the breakdown.</p>
          </div>

          <div className="board-table">
            <div className="board-head">
              <span>#</span>
              <span>Operator</span>
              <span>{metric}</span>
              <span>Signal</span>
            </div>

            {leaderboardRows.length === 0 && !loading ? (
              <article className="board-row empty-row">
                <div className="empty-copy">
                  <strong>No one has posted a usable snapshot yet.</strong>
                  <span>Run <code>npx sloparena go</code> from the terminal to seed the board.</span>
                </div>
              </article>
            ) : null}

            {leaderboardRows.map((row) => {
              const share = maxMetric > 0 ? row.metricValue / maxMetric : 0;
              const active = selectedRow?.id === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`board-row${active ? ' selected' : ''}`}
                  onClick={() => setSelectedUserId(row.id)}
                >
                  <div className={`rank-pill ${rankTone(row.rank)}`}>{rankGlyph(row.rank)}</div>

                  <div className="operator-cell">
                    <Avatar name={row.displayName} url={row.avatarUrl} />
                    <div className="operator-copy">
                      <div className="operator-line">
                        <strong>{row.displayName}</strong>
                        <span className="machine-chip">{row.machines} machine{row.machines === 1 ? '' : 's'}</span>
                      </div>
                      <HandleCluster
                        githubHandle={row.githubHandle}
                        githubUrl={row.githubUrl}
                        xHandle={row.xHandle}
                        xUrl={row.xUrl}
                      />
                      <p className="operator-subline">Top model: {row.topModel}</p>
                    </div>
                  </div>

                  <div className="value-cell">
                    <strong>{formatNumber(row.metricValue)}</strong>
                    <span>updated {formatDate(row.lastSubmitted)}</span>
                  </div>

                  <div className="signal-cell">
                    <div className="signal-track">
                      <span className="signal-fill" style={{ width: `${Math.max(6, share * 100)}%` }} />
                    </div>
                    <span>{formatPercent(share)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="detail-rail">
          {selectedRow ? (
            <div className="detail-stack">
              <section className="detail-card spotlight-card">
                <div className="spotlight-head">
                  <div className="spotlight-badge">selected operator</div>
                  <div className={`rank-ribbon ${rankTone(selectedRow.rank)}`}>rank #{selectedRow.rank}</div>
                </div>

                <div className="spotlight-identity">
                  <Avatar name={selectedRow.displayName} url={selectedRow.avatarUrl} />
                  <div>
                    <h3>{selectedRow.displayName}</h3>
                    <HandleCluster
                      githubHandle={selectedRow.githubHandle}
                      githubUrl={selectedRow.githubUrl}
                      xHandle={selectedRow.xHandle}
                      xUrl={selectedRow.xUrl}
                    />
                  </div>
                </div>

                <div className="spotlight-metric">
                  <span>{metric}</span>
                  <strong>{formatNumber(selectedRow.metricValue)}</strong>
                </div>

                <p className="spotlight-blurb">
                  {selectedRow.githubHandle} is currently leaning hardest on <em>{selectedRow.topModel}</em>, spread across {selectedRow.activityDays} active days and {selectedRow.machines} machine{selectedRow.machines === 1 ? '' : 's'}.
                </p>

                <div className="micro-stats">
                  <div>
                    <span>total traffic</span>
                    <strong>{formatCompactNumber(selectedRow.summary.totals.total)}</strong>
                  </div>
                  <div>
                    <span>activity days</span>
                    <strong>{formatNumber(selectedRow.activityDays)}</strong>
                  </div>
                  <div>
                    <span>last seen</span>
                    <strong>{formatDate(selectedRow.lastSubmitted)}</strong>
                  </div>
                </div>
              </section>

              <section className="detail-card analysis-card">
                <div className="card-heading">
                  <div>
                    <p className="slab-kicker">visual breakdown</p>
                    <h3>Provider split</h3>
                  </div>
                  <span className="card-tag">actual usage share</span>
                </div>

                <div className="provider-ring-row">
                  <div className="provider-ring" style={donutStyle}>
                    <div className="provider-ring-core">
                      <span>mix</span>
                      <strong>{selectedProviderMix.length}</strong>
                    </div>
                  </div>

                  <div className="provider-legend">
                    {selectedProviderMix.map((item) => (
                      <div key={item.provider} className="legend-row">
                        <span className="legend-dot" style={{ background: providerTone(item.provider) }} />
                        <div>
                          <strong>{item.provider}</strong>
                          <span>{formatNumber(item.total)} · {formatPercent(item.share)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="token-stack">
                  {selectedTokenMix.map((item) => (
                    <div key={item.label} className="token-row">
                      <div className="token-copy">
                        <span>{item.label}</span>
                        <strong>{formatNumber(item.value)}</strong>
                      </div>
                      <div className="token-track">
                        <span className="token-fill" style={{ width: `${Math.max(4, item.share * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-card analysis-card">
                <div className="card-heading">
                  <div>
                    <p className="slab-kicker">model ladder</p>
                    <h3>Who is doing the work?</h3>
                  </div>
                  <span className="card-tag">top models by {metric}</span>
                </div>

                <div className="model-ladder">
                  {selectedModels.map((item, index) => (
                    <div key={item.model} className="model-row">
                      <div className="model-order">{index + 1}</div>
                      <div className="model-copy">
                        <strong>{item.model}</strong>
                        <span>{formatNumber(item.value)}</span>
                      </div>
                      <div className="model-track">
                        <span className="model-fill" style={{ width: `${Math.max(6, item.share * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-card analysis-card">
                <div className="card-heading">
                  <div>
                    <p className="slab-kicker">daily pulse</p>
                    <h3>Recent rhythm</h3>
                  </div>
                  <span className="card-tag">last 12 active days</span>
                </div>

                <div className="pulse-strip">
                  {selectedDays.map((day) => (
                    <div key={day.date} className="pulse-column">
                      <div className="pulse-bar-wrap">
                        <span className="pulse-bar" style={{ height: `${day.normalized * 100}%` }} />
                      </div>
                      <strong>{formatCompactNumber(day.value)}</strong>
                      <span>{day.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <section className="detail-card spotlight-card empty-detail">
              <p className="slab-kicker">waiting on data</p>
              <h3>No operator selected yet.</h3>
              <p>When the board has data, this side turns into a visual teardown of the selected builder.</p>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
