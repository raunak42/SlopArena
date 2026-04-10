import { useEffect, useMemo, useState } from 'react';
import {
  addTotals,
  cloneTotals,
  emptyTotals,
  sortModelUsage,
  type DashboardData,
  type ProviderId,
  type ProviderSnapshot,
  type TokenTotals,
  type UserAggregate,
} from '@sloparena/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'https://sloparena-api-production.up.railway.app';
const providers: Array<ProviderId | 'all'> = ['all', 'claude', 'codex'];
const metrics = ['total', 'input', 'output', 'cache'] as const;
const modes = ['users', 'models'] as const;

type MetricKey = (typeof metrics)[number];
type ModeKey = (typeof modes)[number];

interface UserRow {
  id: string;
  displayName: string;
  githubHandle: string;
  githubUrl: string;
  xHandle?: string;
  xUrl?: string;
  avatarUrl?: string;
  machines: number;
  totals: TokenTotals;
  activityDays: number;
  lastSubmitted: string;
  topModel: string;
}

interface ModelRow {
  label: string;
  secondary: string;
  totals: TokenTotals;
  users: number;
}

function metricValue(totals: TokenTotals, metric: MetricKey): number {
  return totals[metric];
}

function mergeProviders(items: ProviderSnapshot[]): ProviderSnapshot {
  const totals = emptyTotals();
  const models = new Map<string, TokenTotals>();
  let activityDays = 0;
  let sourceCount = 0;

  for (const item of items) {
    addTotals(totals, item.totals);
    activityDays += item.activityDays;
    sourceCount += item.sourceCount;
    for (const model of item.byModel) {
      const current = models.get(model.model) ?? emptyTotals();
      addTotals(current, model.tokens);
      models.set(model.model, current);
    }
  }

  return {
    provider: 'claude',
    totals,
    byDay: [],
    byModel: sortModelUsage([...models.entries()].map(([model, tokens]) => ({ model, tokens }))),
    sourceCount,
    activityDays,
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

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
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

function Avatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    return <img className="avatar" src={url} alt={name} referrerPolicy="no-referrer" />;
  }
  return <div className="avatar fallback">{name.slice(0, 1).toUpperCase()}</div>;
}

function ProfileLinks({ githubHandle, githubUrl, xHandle, xUrl }: { githubHandle: string; githubUrl: string; xHandle?: string; xUrl?: string }) {
  return (
    <div className="profile-links">
      <a className="handle-link" href={githubUrl} target="_blank" rel="noreferrer">
        {githubHandle}
      </a>
      {xHandle && xUrl ? (
        <a className="handle-link secondary" href={xUrl} target="_blank" rel="noreferrer">
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
  const [mode, setMode] = useState<ModeKey>('users');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/dashboard`);
        if (!response.ok) {
          throw new Error(`Failed to load dashboard (${response.status})`);
        }
        const payload = (await response.json()) as DashboardData;
        if (!cancelled) {
          setData(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const userRows = useMemo<UserRow[]>(() => {
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
          id: user.userId,
          displayName: user.profile.displayName,
          githubHandle: `@${user.profile.handle}`,
          githubUrl: user.profile.profileUrl || githubHandleToUrl(user.profile.handle),
          xHandle: user.profile.xHandle,
          xUrl: xHandleToUrl(user.profile.xHandle),
          avatarUrl: user.profile.avatarUrl,
          machines: user.machines,
          totals: cloneTotals(summary.totals),
          activityDays: summary.activityDays,
          lastSubmitted: user.lastSubmitted,
          topModel: summary.byModel[0]?.model ?? 'n/a',
        };
      })
      .filter(Boolean)
      .filter((row): row is UserRow => Boolean(row))
      .filter((row) => `${row.displayName} ${row.githubHandle} ${row.xHandle ?? ''}`.toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => metricValue(right.totals, metric) - metricValue(left.totals, metric));
  }, [data, metric, provider, query]);

  const modelRows = useMemo<ModelRow[]>(() => {
    if (!data) {
      return [];
    }

    const modelMap = new Map<string, { totals: TokenTotals; users: Set<string>; providers: Set<string> }>();

    for (const user of data.users) {
      const snapshots = provider === 'all' ? user.providers : user.providers.filter((item) => item.provider === provider);
      for (const snapshot of snapshots) {
        for (const model of snapshot.byModel) {
          const current = modelMap.get(model.model) ?? {
            totals: emptyTotals(),
            users: new Set<string>(),
            providers: new Set<string>(),
          };
          addTotals(current.totals, model.tokens);
          current.users.add(user.userId);
          current.providers.add(snapshot.provider);
          modelMap.set(model.model, current);
        }
      }
    }

    return [...modelMap.entries()]
      .map(([label, value]) => ({
        label,
        secondary: [...value.providers].join(', '),
        totals: value.totals,
        users: value.users.size,
      }))
      .filter((row) => row.label.toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => metricValue(right.totals, metric) - metricValue(left.totals, metric));
  }, [data, metric, provider, query]);

  const totals = useMemo(() => {
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

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">SlopArena</span>
          <h1>GitHub-verified leaderboard for Claude Code and Codex.</h1>
          <p>
            Developers sign in from the terminal with GitHub, optionally add an X handle, and publish local usage snapshots. The board can switch between total usage, input, output, cache, and model rankings instantly.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>Total usage</span>
            <strong>{formatNumber(totals.total)}</strong>
          </div>
          <div className="stat-card">
            <span>Active users</span>
            <strong>{formatNumber(data?.activeUsers ?? 0)}</strong>
          </div>
          <div className="stat-card">
            <span>Tracked machines</span>
            <strong>{formatNumber(data?.activeMachines ?? 0)}</strong>
          </div>
        </div>
      </section>

      <section className="panel controls">
        <div className="toggle-group">
          {providers.map((item) => (
            <button key={item} className={provider === item ? 'active' : ''} onClick={() => setProvider(item)}>
              {item === 'all' ? 'All providers' : item}
            </button>
          ))}
        </div>
        <div className="toggle-group">
          {modes.map((item) => (
            <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="toggle-group">
          {metrics.map((item) => (
            <button key={item} className={metric === item ? 'active' : ''} onClick={() => setMetric(item)}>
              {item}
            </button>
          ))}
        </div>
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by GitHub handle, X handle, or model"
        />
      </section>

      {loading ? <section className="panel">Loading dashboard…</section> : null}
      {error ? <section className="panel error">{error}</section> : null}

      {!loading && !error && data ? (
        <section className="grid-layout">
          <div className="panel leaderboard-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Leaderboard</span>
                <h2>{mode === 'users' ? 'Top builders' : 'Top models'}</h2>
              </div>
              <span className="muted">Sorted by {metric}</span>
            </div>

            <div className="leaderboard-table">
              {(mode === 'users' ? userRows : modelRows).map((row, index) => (
                <article className="leaderboard-row" key={'id' in row ? row.id : row.label}>
                  <div className="rank">#{index + 1}</div>
                  {'githubHandle' in row ? (
                    <div className="user-identity">
                      <Avatar name={row.displayName} url={row.avatarUrl} />
                      <div className="row-main">
                        <strong>{row.displayName}</strong>
                        <ProfileLinks
                          githubHandle={row.githubHandle}
                          githubUrl={row.githubUrl}
                          xHandle={row.xHandle}
                          xUrl={row.xUrl}
                        />
                        <span>{row.machines} machine{row.machines === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="row-main">
                      <strong>{row.label}</strong>
                      <span>{row.secondary}</span>
                    </div>
                  )}
                  <div className="row-metric">
                    <span>{metric}</span>
                    <strong>{formatNumber(metricValue(row.totals, metric))}</strong>
                  </div>
                  {'activityDays' in row ? (
                    <div className="row-meta">
                      <span>{row.activityDays} active days</span>
                      <span>Top model: {row.topModel}</span>
                      <span>Updated {formatDate(row.lastSubmitted)}</span>
                    </div>
                  ) : (
                    <div className="row-meta">
                      <span>{row.users} users</span>
                      <span>Total: {formatNumber(row.totals.total)}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <aside className="stack">
            <section className="panel">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Metrics</span>
                  <h2>Selected totals</h2>
                </div>
              </div>
              <dl className="metric-list">
                <div>
                  <dt>Total</dt>
                  <dd>{formatNumber(totals.total)}</dd>
                </div>
                <div>
                  <dt>Input</dt>
                  <dd>{formatNumber(totals.input)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{formatNumber(totals.output)}</dd>
                </div>
                <div>
                  <dt>Cache</dt>
                  <dd>{formatNumber(totals.cache)}</dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Recent</span>
                  <h2>Latest submissions</h2>
                </div>
              </div>
              <div className="recent-list">
                {data.recentSubmissions.map((submission) => (
                  <article className="recent-item" key={submission.id}>
                    <div className="recent-user">
                      <Avatar name={submission.profile.displayName} url={submission.profile.avatarUrl} />
                      <div>
                        <strong>{submission.profile.displayName}</strong>
                        <ProfileLinks
                          githubHandle={`@${submission.profile.handle}`}
                          githubUrl={submission.profile.profileUrl || githubHandleToUrl(submission.profile.handle)}
                          xHandle={submission.profile.xHandle}
                          xUrl={xHandleToUrl(submission.profile.xHandle)}
                        />
                      </div>
                    </div>
                    <span>{submission.machineId}</span>
                    <span>{submission.providers.map((item) => `${item.provider}: ${formatNumber(item.totals.total)}`).join(' · ')}</span>
                    <time>{formatDate(submission.submittedAt)}</time>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
