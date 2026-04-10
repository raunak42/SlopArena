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
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Copy,
  MoonStar,
  RefreshCw,
  SunMedium,
  Terminal,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Card, CardContent } from './components/ui/card';
import { Input } from './components/ui/input';
import { cn } from './lib/utils';

const API_URL = import.meta.env.VITE_API_URL ?? 'https://usageboard-api-production.up.railway.app';
const COMMAND = 'npx sloparena go';
const providers: Array<ProviderId | 'all'> = ['all', 'claude', 'codex'];
const metrics = ['total', 'input', 'output', 'cache'] as const;
const windows = [30, 90, 365] as const;

type MetricKey = (typeof metrics)[number];
type WindowKey = (typeof windows)[number];
type ThemeKey = 'light' | 'dark';

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
  growth: number;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return '0%';
}

function metricValue(totals: TokenTotals, metric: MetricKey): number {
  return totals[metric];
}

function githubHandleToUrl(handle: string): string {
  return `https://github.com/${handle.replace(/^@/, '')}`;
}

function xHandleToUrl(handle?: string): string | undefined {
  if (!handle) return undefined;
  return `https://x.com/${handle.replace(/^@/, '')}`;
}

function getThemePreference(): ThemeKey {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem('sloparena-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function rebuildSnapshot(provider: ProviderId, byDay: DailyUsage[], sourceCount: number): ProviderSnapshot {
  const totals = emptyTotals();
  const modelMap = new Map<string, TokenTotals>();

  for (const day of byDay) {
    addTotals(totals, day.totals);
    for (const model of day.models) {
      const current = modelMap.get(model.model) ?? emptyTotals();
      addTotals(current, model.tokens);
      modelMap.set(model.model, current);
    }
  }

  return {
    provider,
    totals,
    byDay: [...byDay].sort((left, right) => left.date.localeCompare(right.date)),
    byModel: sortModelUsage([...modelMap.entries()].map(([model, tokens]) => ({ model, tokens }))),
    sourceCount,
    activityDays: byDay.filter((day) => day.totals.total > 0 || day.displayValue).length,
  };
}

function dateDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function filterByWindow(byDay: DailyUsage[], days: number): DailyUsage[] {
  if (days >= 365) return byDay;
  const cutoff = dateDaysAgo(days - 1).getTime();
  return byDay.filter((day) => new Date(`${day.date}T00:00:00`).getTime() >= cutoff);
}

function filterRange(byDay: DailyUsage[], startDaysAgo: number, endDaysAgo: number): DailyUsage[] {
  const start = dateDaysAgo(startDaysAgo).getTime();
  const end = dateDaysAgo(endDaysAgo).getTime();
  return byDay.filter((day) => {
    const timestamp = new Date(`${day.date}T00:00:00`).getTime();
    return timestamp >= start && timestamp <= end;
  });
}

function mergeProviderSnapshots(items: ProviderSnapshot[]): ProviderSnapshot {
  if (items.length === 1) {
    return items[0];
  }

  const dayMap = new Map<string, { totals: TokenTotals; models: Map<string, TokenTotals>; displayValue?: number }>();
  let sourceCount = 0;

  for (const item of items) {
    sourceCount += item.sourceCount;
    for (const day of item.byDay) {
      const current = dayMap.get(day.date) ?? {
        totals: emptyTotals(),
        models: new Map<string, TokenTotals>(),
        displayValue: 0,
      };
      addTotals(current.totals, day.totals);
      current.displayValue = (current.displayValue ?? 0) + (day.displayValue ?? 0);
      for (const model of day.models) {
        const modelTotals = current.models.get(model.model) ?? emptyTotals();
        addTotals(modelTotals, model.tokens);
        current.models.set(model.model, modelTotals);
      }
      dayMap.set(day.date, current);
    }
  }

  const byDay: DailyUsage[] = [...dayMap.entries()].map(([date, value]) => ({
    date,
    totals: value.totals,
    models: sortModelUsage([...value.models.entries()].map(([model, tokens]) => ({ model, tokens }))),
    displayValue: value.displayValue ? value.displayValue : undefined,
  }));

  return rebuildSnapshot('claude', byDay, sourceCount);
}

function pickProvider(user: UserAggregate, provider: ProviderId | 'all', windowDays: WindowKey): ProviderSnapshot | null {
  const snapshots = (provider === 'all' ? user.providers : user.providers.filter((item) => item.provider === provider)).map((item) =>
    rebuildSnapshot(item.provider, filterByWindow(item.byDay, windowDays), item.sourceCount),
  );

  const nonEmpty = snapshots.filter((item) => item.byDay.length > 0 || item.totals.total > 0 || item.activityDays > 0);
  if (!nonEmpty.length) return null;
  return provider === 'all' ? mergeProviderSnapshots(nonEmpty) : nonEmpty[0];
}

function growthForUser(user: UserAggregate, provider: ProviderId | 'all'): number {
  const snapshots = provider === 'all' ? user.providers : user.providers.filter((item) => item.provider === provider);
  if (!snapshots.length) return 0;

  const combined = provider === 'all' ? mergeProviderSnapshots(snapshots) : snapshots[0];
  const recent = rebuildSnapshot(combined.provider, filterRange(combined.byDay, 29, 0), combined.sourceCount).totals.total;
  const previous = rebuildSnapshot(combined.provider, filterRange(combined.byDay, 59, 30), combined.sourceCount).totals.total;

  if (previous === 0 && recent === 0) return 0;
  if (previous === 0) return 1;
  return (recent - previous) / previous;
}

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function rankGlyph(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function Avatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    return <img className="size-11 rounded-full border object-cover" src={url} alt={name} referrerPolicy="no-referrer" />;
  }

  return (
    <div className="flex size-11 items-center justify-center rounded-full border bg-muted text-sm font-medium">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" className="h-11 gap-2 rounded-2xl" onClick={handleCopy}>
      <Copy className="size-4" />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const [metric, setMetric] = useState<MetricKey>('total');
  const [windowDays, setWindowDays] = useState<WindowKey>(365);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [theme, setTheme] = useState<ThemeKey>(getThemePreference);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
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
          throw new Error(`Failed to load leaderboard (${response.status})`);
        }
        const payload = (await response.json()) as DashboardData;
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
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

  const rows = useMemo<LeaderboardRow[]>(() => {
    if (!data) return [];

    return data.users
      .map((user) => {
        const summary = pickProvider(user, provider, windowDays);
        if (!summary) return null;

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
          growth: growthForUser(user, provider),
        };
      })
      .filter((row): row is LeaderboardRow => Boolean(row))
      .sort((left, right) => right.metricValue - left.metricValue || right.totals.total - left.totals.total || left.displayName.localeCompare(right.displayName))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, [data, metric, provider, windowDays]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !rows.some((row) => row.id === selectedUserId)) {
      setSelectedUserId(rows[0].id);
    }
  }, [rows, selectedUserId]);

  const selected = rows.find((row) => row.id === selectedUserId) ?? rows[0] ?? null;

  const selectedProviderBars = useMemo(() => {
    if (!selected) return [] as Array<{ label: string; value: number; percent: number }>;
    const total = selected.summary.totals.total || 1;
    return [
      { label: 'Input', value: selected.summary.totals.input, percent: selected.summary.totals.input / total },
      { label: 'Output', value: selected.summary.totals.output, percent: selected.summary.totals.output / total },
      { label: 'Cache', value: selected.summary.totals.cache, percent: selected.summary.totals.cache / total },
    ];
  }, [selected]);

  const selectedModels = useMemo(() => {
    if (!selected) return [] as Array<{ label: string; value: number; percent: number }>;
    const max = selected.summary.byModel[0] ? metricValue(selected.summary.byModel[0].tokens, metric) : 1;
    return selected.summary.byModel.slice(0, 5).map((item) => ({
      label: item.model,
      value: metricValue(item.tokens, metric),
      percent: max > 0 ? metricValue(item.tokens, metric) / max : 0,
    }));
  }, [metric, selected]);

  const totalMetric = useMemo(() => rows.reduce((sum, row) => sum + row.metricValue, 0), [rows]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.07),_transparent_35%),linear-gradient(to_bottom,_transparent,_rgba(0,0,0,0.04))] dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.045),_transparent_32%),linear-gradient(to_bottom,_transparent,_rgba(255,255,255,0.02))]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between pb-8">
          <div className="inline-flex items-center gap-3 text-sm font-medium">
            <div className="flex size-8 items-center justify-center rounded-full border bg-foreground text-background">S</div>
            <span>SlopArena</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
          </Button>
        </header>

        <section className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
          <Badge variant="muted" className="rounded-full px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase">
            cli-native leaderboard · github-verified
          </Badge>
          <h1 className="mt-6 max-w-5xl text-balance font-sans text-5xl font-medium tracking-[-0.08em] sm:text-6xl lg:text-8xl">
            Welcome to the Slop Arena
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
            Publish your Claude Code and Codex receipts from the terminal, get ranked in public, and watch who is actually carrying the token economy.
          </p>

          <div className="mt-10 flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Terminal className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input readOnly value={COMMAND} className="h-12 rounded-2xl pl-11 font-mono text-sm" />
            </div>
            <CopyCommandButton command={COMMAND} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span>GitHub login</span>
            <span className="hidden sm:inline">·</span>
            <span>365-day snapshots</span>
            <span className="hidden sm:inline">·</span>
            <span>Local logs only</span>
            <span className="hidden sm:inline">·</span>
            <span>Manual refresh</span>
          </div>
        </section>

        <section className="mt-16">
          <Card className="overflow-hidden rounded-[28px] border-border/80 bg-card/80 backdrop-blur">
            <CardContent className="p-0">
              <div className="flex flex-col gap-4 border-b border-border/70 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-3xl font-medium tracking-[-0.06em]">Leaderboard</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {rows.length ? `${formatCompact(totalMetric)} ${metric} across ${rows.length} verified builders.` : 'No ranked builders yet.'}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="relative">
                    <select
                      value={metric}
                      onChange={(event) => setMetric(event.target.value as MetricKey)}
                      className="h-11 min-w-36 appearance-none rounded-2xl border border-border bg-background px-4 pr-10 text-sm outline-none ring-0 transition focus:border-ring"
                    >
                      {metrics.map((item) => (
                        <option key={item} value={item}>
                          {item[0].toUpperCase() + item.slice(1)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </label>

                  <label className="relative">
                    <select
                      value={windowDays}
                      onChange={(event) => setWindowDays(Number(event.target.value) as WindowKey)}
                      className="h-11 min-w-36 appearance-none rounded-2xl border border-border bg-background px-4 pr-10 text-sm outline-none ring-0 transition focus:border-ring"
                    >
                      {windows.map((item) => (
                        <option key={item} value={item}>
                          {item} days
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </label>

                  <label className="relative">
                    <select
                      value={provider}
                      onChange={(event) => setProvider(event.target.value as ProviderId | 'all')}
                      className="h-11 min-w-40 appearance-none rounded-2xl border border-border bg-background px-4 pr-10 text-sm outline-none ring-0 transition focus:border-ring"
                    >
                      {providers.map((item) => (
                        <option key={item} value={item}>
                          {item === 'all' ? 'All providers' : item}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </label>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-2xl"
                    onClick={() => setReloadTick((value) => value + 1)}
                    disabled={loading}
                  >
                    <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                    {loading ? 'Refreshing' : 'Refresh'}
                  </Button>
                </div>
              </div>

              {error ? (
                <div className="border-b border-border/70 bg-destructive/5 px-6 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="hidden grid-cols-[72px,minmax(0,1.7fr),minmax(0,1fr),180px,140px] gap-4 px-6 py-5 text-sm text-muted-foreground md:grid">
                <span>#</span>
                <span>Builder</span>
                <span>Identity</span>
                <span className="text-right">{metric[0].toUpperCase() + metric.slice(1)}</span>
                <span className="text-right">30D Growth</span>
              </div>

              <div>
                {rows.length === 0 && !loading ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-base font-medium">No one has submitted a ranked snapshot yet.</p>
                    <p className="mt-2 text-sm text-muted-foreground">Copy the command above and seed the board.</p>
                  </div>
                ) : null}

                {rows.map((row) => {
                  const positive = row.growth > 0;
                  const negative = row.growth < 0;
                  const selectedRow = selectedUserId === row.id;

                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedUserId(row.id)}
                      className={cn(
                        'grid w-full gap-4 border-t border-border/70 px-6 py-5 text-left transition-colors',
                        'md:grid-cols-[72px,minmax(0,1.7fr),minmax(0,1fr),180px,140px] md:items-center',
                        selectedRow && 'bg-accent/40',
                      )}
                    >
                      <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.04em] md:text-base md:font-normal md:tracking-normal">
                        <span className="inline-flex min-w-10 items-center justify-start font-mono text-base text-foreground">{rankGlyph(row.rank)}</span>
                      </div>

                      <div className="flex min-w-0 items-center gap-4">
                        <Avatar name={row.displayName} url={row.avatarUrl} />
                        <div className="min-w-0">
                          <div className="truncate text-lg font-medium tracking-[-0.04em]">{row.displayName}</div>
                          <div className="mt-1 truncate text-sm text-muted-foreground">
                            {row.topModel} · {row.activityDays} active days · {row.machines} machine{row.machines === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col gap-2">
                        <a
                          href={row.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm font-medium hover:text-foreground/80"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.githubHandle}
                        </a>
                        <div className="flex flex-wrap gap-2">
                          {row.xHandle ? <Badge variant="muted">@{row.xHandle}</Badge> : <Badge variant="outline">GitHub only</Badge>}
                        </div>
                      </div>

                      <div className="text-left md:text-right">
                        <div className="text-2xl font-medium tracking-[-0.05em] md:text-[2rem]">{formatNumber(row.metricValue)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">updated {formatUpdatedAt(row.lastSubmitted)}</div>
                      </div>

                      <div className="flex items-center justify-start gap-2 md:justify-end">
                        {positive ? (
                          <ArrowUpRight className="size-5 text-emerald-500" />
                        ) : negative ? (
                          <ArrowDownRight className="size-5 text-rose-500" />
                        ) : (
                          <div className="size-5 rounded-full border border-border" />
                        )}
                        <span
                          className={cn(
                            'text-2xl font-medium tracking-[-0.05em]',
                            positive && 'text-emerald-500',
                            negative && 'text-rose-500',
                            !positive && !negative && 'text-muted-foreground',
                          )}
                        >
                          {formatPercent(row.growth)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        {selected ? (
          <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
            <Card className="rounded-[28px] border-border/80 bg-card/80 backdrop-blur">
              <CardContent className="p-6">
                <div className="flex flex-col gap-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">selected operator</p>
                      <h3 className="mt-2 text-3xl font-medium tracking-[-0.06em]">{selected.displayName}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selected.githubHandle} · top model {selected.topModel}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full px-3 py-1">rank #{selected.rank}</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                      <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">{metric}</div>
                      <div className="mt-3 text-3xl font-medium tracking-[-0.06em]">{formatCompact(selected.metricValue)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                      <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">growth</div>
                      <div className="mt-3 text-3xl font-medium tracking-[-0.06em]">{formatPercent(selected.growth)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                      <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">updated</div>
                      <div className="mt-3 text-lg font-medium tracking-[-0.04em]">{formatUpdatedAt(selected.lastSubmitted)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">traffic composition</p>
                        <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Token split</h4>
                      </div>
                      <Badge variant="muted">{windowDays} day view</Badge>
                    </div>
                    <div className="space-y-4">
                      {selectedProviderBars.map((item) => (
                        <div key={item.label} className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-mono">{formatNumber(item.value)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.max(4, item.percent * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-border/80 bg-card/80 backdrop-blur">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">model breakdown</p>
                    <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Top models</h4>
                  </div>
                  <Badge variant="muted">{metric}</Badge>
                </div>
                <div className="space-y-4">
                  {selectedModels.map((item) => (
                    <div key={item.label} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-muted-foreground">{item.label}</span>
                        <span className="font-mono">{formatNumber(item.value)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.max(5, item.percent * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}
