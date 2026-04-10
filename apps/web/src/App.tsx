import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addTotals,
  emptyTotals,
  sortModelUsage,
  type DashboardData,
  type DailyUsage,
  type ModelUsage,
  type ProviderId,
  type ProviderSnapshot,
  type PublicProfile,
  type TokenTotals,
  type UsageSnapshot,
  type UserAggregate,
} from '@sloparena/shared';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Copy,
  MoonStar,
  RefreshCw,
  Star,
  SunMedium,
  Terminal,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Skeleton } from './components/ui/skeleton';
import { cn } from './lib/utils';
import logoUrl from './assets/sloparena-logo.svg';

const API_URL = import.meta.env.VITE_API_URL ?? 'https://usageboard-api-production.up.railway.app';
const REPO_URL = 'https://github.com/raunak42/SlopArena';
const REPO_API_URL = 'https://api.github.com/repos/raunak42/SlopArena';
const COMMAND = 'npx sloparena go';
const providers: Array<ProviderId | 'all'> = ['all', 'claude', 'codex'];
const metrics = ['total', 'input', 'output', 'cache'] as const;
const windows = [1, 30, 90, 365] as const;

type MetricKey = (typeof metrics)[number];
type WindowKey = (typeof windows)[number];
type ThemeKey = 'light' | 'dark';

const ROW_CHUNK_SIZE = 10;
const PAGE_ROW_LIMIT = 100;

type PageViewState = {
  visibleCount: number;
  selectedUserId: string | null;
  scrollY: number;
};

type DetailBar = {
  label: string;
  value: number;
  percent: number;
};

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
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US').format(Math.round(safeValue));
}

function formatCompact(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: safeValue >= 1_000_000 ? 1 : 0,
  }).format(safeValue);
}

function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safeValue * 100);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return '0%';
}

function formatWindowLabel(windowDays: number): string {
  return windowDays === 1 ? '24 hours' : `${windowDays} days`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asPositiveInteger(value: unknown, fallback = 0): number {
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asUrl(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;

  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function asIsoDate(value: unknown, fallback: string): string {
  const text = asString(value);
  const timestamp = text ? Date.parse(text) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function asDateKey(value: unknown, fallback: string): string {
  const text = asString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(new Date(`${text}T00:00:00Z`).getTime())) {
    return text;
  }

  const timestamp = text ? Date.parse(text) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : fallback;
}

function asProviderId(value: unknown, fallback: ProviderId = 'claude'): ProviderId {
  return value === 'claude' || value === 'codex' ? value : fallback;
}

function metricValue(totals: TokenTotals, metric: MetricKey): number {
  return Number.isFinite(totals?.[metric]) ? totals[metric] : 0;
}

function normalizeHandle(handle?: string): string {
  return (handle ?? '').trim().replace(/^@+/, '');
}

function displayHandle(handle?: string): string {
  const normalized = normalizeHandle(handle);
  return normalized ? `@${normalized}` : '';
}

function githubHandleToUrl(handle: string): string {
  return `https://github.com/${normalizeHandle(handle)}`;
}

function xHandleToUrl(handle?: string): string | undefined {
  if (!handle) return undefined;
  return `https://x.com/${normalizeHandle(handle)}`;
}

function normalizeTotals(value: unknown, provider?: ProviderId): TokenTotals {
  const record = isRecord(value) ? value : {};
  const input = asPositiveInteger(record.input, 0);
  const output = asPositiveInteger(record.output, 0);
  const cache = asPositiveInteger(record.cache, 0);
  const computedTotal = input + output + cache;
  const providedTotal = asPositiveInteger(record.total, computedTotal);

  if (provider === 'claude' && cache > 0 && providedTotal === input + output) {
    const nonCacheTotal = Math.max(0, providedTotal - cache);
    const weightSum = input + output;
    const nextInput = weightSum > 0 ? Math.round((input / weightSum) * nonCacheTotal) : nonCacheTotal;
    const nextOutput = Math.max(0, nonCacheTotal - nextInput);

    return {
      input: nextInput,
      output: nextOutput,
      cache,
      total: nextInput + nextOutput + cache,
    };
  }

  if (provider === 'codex') {
    return {
      input,
      output,
      cache,
      total: Math.max(computedTotal, providedTotal),
    };
  }

  return {
    input,
    output,
    cache,
    total: providedTotal,
  };
}

function normalizeModelUsage(value: unknown, index: number, provider?: ProviderId): ModelUsage {
  const record = isRecord(value) ? value : {};
  return {
    model: asString(record.model, `unknown-model-${index + 1}`),
    tokens: normalizeTotals(record.tokens, provider),
  };
}

function normalizeDailyUsage(value: unknown, index: number, provider?: ProviderId): DailyUsage {
  const record = isRecord(value) ? value : {};
  const fallbackDate = new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
  const displayValue = asNumber(record.displayValue, Number.NaN);

  return {
    date: asDateKey(record.date, fallbackDate),
    totals: normalizeTotals(record.totals, provider),
    models: asArray(record.models).map((item, modelIndex) => normalizeModelUsage(item, modelIndex, provider)),
    displayValue: Number.isFinite(displayValue) ? displayValue : undefined,
  };
}

function normalizeProviderSnapshot(value: unknown, index: number): ProviderSnapshot {
  const record = isRecord(value) ? value : {};
  const provider = asProviderId(record.provider, index % 2 === 0 ? 'claude' : 'codex');
  const totals = normalizeTotals(record.totals, provider);
  const byModel = asArray(record.byModel).map((item, modelIndex) => normalizeModelUsage(item, modelIndex, provider));
  let byDay = asArray(record.byDay).map((item, dayIndex) => normalizeDailyUsage(item, dayIndex, provider));

  if (!byDay.length && (totals.total > 0 || byModel.length > 0)) {
    byDay = [
      {
        date: new Date().toISOString().slice(0, 10),
        totals,
        models: byModel,
      },
    ];
  }

  const snapshot = rebuildSnapshot(provider, byDay, asPositiveInteger(record.sourceCount, 0));
  return {
    ...snapshot,
    sourceCount: asPositiveInteger(record.sourceCount, snapshot.sourceCount),
    activityDays: Math.max(snapshot.activityDays, asPositiveInteger(record.activityDays, snapshot.activityDays)),
  };
}

function normalizeProfile(value: unknown, index: number): PublicProfile {
  const record = isRecord(value) ? value : {};
  const handle = normalizeHandle(asString(record.handle, '')) || `builder${index + 1}`;
  const xHandle = normalizeHandle(asString(record.xHandle, '')) || undefined;

  return {
    provider: 'github',
    providerUserId: asString(record.providerUserId, `unknown-user-${index + 1}`),
    handle,
    displayName: asString(record.displayName, handle),
    avatarUrl: asUrl(record.avatarUrl),
    profileUrl: asUrl(record.profileUrl) ?? githubHandleToUrl(handle),
    xHandle,
  };
}

function normalizeUsageSnapshot(value: unknown, index: number): UsageSnapshot {
  const record = isRecord(value) ? value : {};
  const fallbackTimestamp = new Date().toISOString();
  const profile = normalizeProfile(record.profile, index);

  return {
    id: asString(record.id, `snapshot-${index + 1}`),
    userId: asString(record.userId, profile.providerUserId),
    machineId: asString(record.machineId, `machine-${index + 1}`),
    capturedAt: asIsoDate(record.capturedAt, fallbackTimestamp),
    submittedAt: asIsoDate(record.submittedAt, fallbackTimestamp),
    windowDays: Math.max(1, asPositiveInteger(record.windowDays, 365)),
    cliVersion: asString(record.cliVersion, 'unknown'),
    profile,
    providers: asArray(record.providers).map((item, providerIndex) => normalizeProviderSnapshot(item, providerIndex)),
  };
}

function normalizeUserAggregate(value: unknown, index: number): UserAggregate {
  const record = isRecord(value) ? value : {};
  const profile = normalizeProfile(record.profile, index);
  const providers = asArray(record.providers).map((item, providerIndex) => normalizeProviderSnapshot(item, providerIndex));

  return {
    userId: asString(record.userId, profile.providerUserId),
    profile,
    machines: asPositiveInteger(record.machines, 0),
    lastSubmitted: asIsoDate(record.lastSubmitted, new Date().toISOString()),
    providers,
  };
}

function normalizeDashboardData(value: unknown): DashboardData {
  const record = isRecord(value) ? value : {};
  const users = asArray(record.users).map((item, index) => normalizeUserAggregate(item, index));
  const recentSubmissions = asArray(record.recentSubmissions).map((item, index) => normalizeUsageSnapshot(item, index));

  return {
    generatedAt: asIsoDate(record.generatedAt, new Date().toISOString()),
    historyCount: asPositiveInteger(record.historyCount, recentSubmissions.length || users.length),
    activeUsers: asPositiveInteger(record.activeUsers, users.length),
    activeMachines: asPositiveInteger(
      record.activeMachines,
      users.reduce((sum, user) => sum + user.machines, 0),
    ),
    users,
    recentSubmissions,
  };
}

function getThemePreference(): ThemeKey {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = window.localStorage.getItem('sloparena-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage access issues and fall back to system preference.
  }

  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
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

  if (days === 1) {
    const latestActiveDay = [...byDay]
      .reverse()
      .find((day) => day.totals.total > 0 || (day.displayValue ?? 0) > 0);

    return latestActiveDay ? [latestActiveDay] : [];
  }

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
  const sourceProviders = provider === 'all' ? user.providers : user.providers.filter((item) => item.provider === provider);

  if (provider === 'all' && windowDays === 1) {
    const latestActiveDate = sourceProviders
      .flatMap((item) => item.byDay)
      .filter((day) => day.totals.total > 0 || (day.displayValue ?? 0) > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
      .at(-1)?.date;

    if (!latestActiveDate) {
      return null;
    }

    const snapshots = sourceProviders.map((item) =>
      rebuildSnapshot(item.provider, item.byDay.filter((day) => day.date === latestActiveDate), item.sourceCount),
    );
    const nonEmpty = snapshots.filter((item) => item.byDay.length > 0 || item.totals.total > 0 || item.activityDays > 0);
    return nonEmpty.length ? mergeProviderSnapshots(nonEmpty) : null;
  }

  const snapshots = sourceProviders.map((item) => rebuildSnapshot(item.provider, filterByWindow(item.byDay, windowDays), item.sourceCount));

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
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown';

  return new Date(timestamp).toLocaleString(undefined, {
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

function dicebearAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed)}`;
}

function Avatar({ name, url, seed, className }: { name: string; url?: string; seed?: string; className?: string }) {
  const safeName = asString(name, 'Unknown builder');
  const safeUrl = asUrl(url);
  const safeSeed = asString(seed, safeName).toLowerCase();
  const fallbackUrl = dicebearAvatarUrl(safeSeed);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [safeUrl, fallbackUrl]);

  const displayUrl = imageFailed ? fallbackUrl : safeUrl ?? fallbackUrl;

  if (displayUrl) {
    return (
      <img
        className={cn('size-8 rounded-md border object-cover', className)}
        src={displayUrl}
        alt={safeName}
        referrerPolicy="no-referrer"
        onError={() => {
          if (!imageFailed && safeUrl && displayUrl !== fallbackUrl) {
            setImageFailed(true);
          }
        }}
      />
    );
  }

  return (
    <div className={cn('flex size-8 items-center justify-center rounded-md border bg-muted text-[10px] font-medium', className)}>
      {safeName.slice(0, 1).toUpperCase()}
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
    <Button
      type="button"
      variant="outline"
      className="h-12 w-[176px] shrink-0 justify-center gap-2 rounded-sm px-4 sm:w-[200px] sm:px-6"
      onClick={handleCopy}
      aria-label={copied ? 'Command copied' : 'Copy the SlopArena command'}
      title={copied ? 'Command copied' : 'Copy the SlopArena command'}
    >
      <Copy className="size-4" />
      {copied ? 'Copied' : 'Copy command'}
    </Button>
  );
}

function RepoStarButton() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStars() {
      try {
        const response = await fetch(REPO_API_URL, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { stargazers_count?: unknown };
        const count = typeof payload.stargazers_count === 'number' ? payload.stargazers_count : Number.NaN;
        if (Number.isFinite(count)) {
          setStars(count);
        }
      } catch {
        // Ignore star-count fetch issues; the button still works as a repo link.
      }
    }

    void loadStars();
    return () => controller.abort();
  }, []);

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex h-8 items-center gap-2 rounded-sm border border-border/80 bg-card/80 px-2.5 text-sm font-medium text-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-[transform,border-color,background-color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-foreground/16 hover:bg-card active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      aria-label={stars !== null ? `View the SlopArena GitHub repository, ${formatNumber(stars)} stars` : 'View the SlopArena GitHub repository'}
      title={stars !== null ? `${formatNumber(stars)} GitHub stars` : 'View the SlopArena GitHub repository'}
    >
      <GithubMarkIcon className="size-[15px] shrink-0" />
      <span className="min-w-[1.8rem] text-[1rem] leading-none tracking-[-0.04em]">{stars !== null ? formatCompact(stars) : 'Star'}</span>
      <span className="inline-flex size-4.5 items-center justify-center rounded-sm bg-amber-400/12 text-amber-500 dark:bg-amber-300/12 dark:text-amber-300">
        <Star className="size-2.5 fill-current" />
      </span>
    </a>
  );
}

function GithubMarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 .5C5.648.5.5 5.648.5 12A11.5 11.5 0 0 0 8.36 22.09c.575.106.785-.25.785-.556c0-.274-.01-1-.016-1.963c-3.183.692-3.854-1.534-3.854-1.534c-.52-1.322-1.27-1.674-1.27-1.674c-1.039-.711.078-.697.078-.697c1.149.08 1.752 1.18 1.752 1.18c1.02 1.748 2.676 1.243 3.327.95c.104-.74.4-1.244.726-1.53c-2.54-.29-5.211-1.27-5.211-5.655c0-1.249.446-2.27 1.178-3.07c-.118-.288-.51-1.45.112-3.022c0 0 .96-.307 3.146 1.173A10.97 10.97 0 0 1 12 6.032c.973.004 1.953.132 2.868.387c2.184-1.48 3.142-1.173 3.142-1.173c.624 1.571.232 2.733.114 3.022c.734.8 1.176 1.821 1.176 3.07c0 4.396-2.676 5.361-5.224 5.646c.411.354.777 1.05.777 2.117c0 1.53-.014 2.764-.014 3.14c0 .31.206.669.792.555A11.502 11.502 0 0 0 23.5 12C23.5 5.648 18.352.5 12 .5Z" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.041 9.19L24 22.847h-7.406l-5.8-7.584l-6.637 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.645h2.039L6.486 3.24H4.298z" />
    </svg>
  );
}

function LeaderboardRowSkeleton({ index }: { index: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid w-full grid-cols-[minmax(0,1fr),280px] items-center gap-4 px-6 py-2.5',
        index > 0 && 'border-t border-border/70',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 overflow-visible">
        <Skeleton className="h-5 w-9 rounded-sm" />
        <Skeleton className="size-10 rounded-xl border border-border/60" />
        <div className="min-w-0 flex-1 font-mono">
          <div className="grid min-w-0 gap-y-1 overflow-hidden min-[420px]:flex min-[420px]:items-center min-[420px]:gap-2 min-[420px]:gap-y-0">
            <Skeleton className="h-3.5 w-[6.5rem] max-w-[50%]" />
            <Skeleton className="h-3.5 w-[5.5rem] max-w-[38%]" />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
            <Skeleton className="h-3 w-[8.5rem] max-w-[65%]" />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-12" />
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
          <Skeleton className="h-full w-[72%] rounded-full bg-foreground/18" />
        </div>
      </div>
    </div>
  );
}

function SelectedPanelSkeleton({ metric, windowDays }: { metric: MetricKey; windowDays: WindowKey }) {
  return (
    <div aria-hidden="true">
      <section className="px-5 py-5 lg:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <Skeleton className="size-16 shrink-0 rounded-xl border border-border/60" />
              <div className="min-w-0">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-3 h-8 w-44 max-w-[70vw]" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-[4.5rem]" />
                  <Skeleton className="h-4 w-[6.5rem]" />
                </div>
              </div>
            </div>
            <Skeleton className="h-6 w-[4.5rem]" />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="border border-border/70 bg-muted/20 p-3.5">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {index === 0 ? metric : index === 1 ? 'growth' : 'updated'}
                </div>
                <Skeleton className={cn('mt-2.5', index === 2 ? 'h-5 w-[6.5rem]' : 'h-8 w-24')} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-5 lg:px-6">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">model breakdown</p>
            <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Top models</h4>
          </div>
          <Badge variant="muted" className="rounded-sm px-2 py-0.5 text-[11px]">{metric}</Badge>
        </div>
        <div className="space-y-3.5">
          {['84%', '68%', '52%', '38%', '26%'].map((width, index) => (
            <div key={index} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
                <Skeleton className="h-full rounded-full bg-foreground/18" style={{ width }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 py-5 lg:px-6">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">traffic composition</p>
            <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Token split</h4>
          </div>
          <Badge variant="muted" className="rounded-sm px-2 py-0.5 text-[11px]">{formatWindowLabel(windowDays)} view</Badge>
        </div>
        <div className="space-y-3.5">
          {['82%', '59%', '34%'].map((width, index) => (
            <div key={index} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
                <Skeleton className="h-full rounded-full bg-foreground/18" style={{ width }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SelectedPanelContent({
  selected,
  metric,
  windowDays,
  selectedProviderBars,
  selectedModels,
  loading = false,
}: {
  selected: LeaderboardRow | null;
  metric: MetricKey;
  windowDays: WindowKey;
  selectedProviderBars: DetailBar[];
  selectedModels: DetailBar[];
  loading?: boolean;
}) {
  if (loading && !selected) {
    return <SelectedPanelSkeleton metric={metric} windowDays={windowDays} />;
  }

  if (!selected) {
    return <div className="px-5 py-8 text-sm text-muted-foreground lg:px-6">Pick a builder to inspect the breakdown.</div>;
  }

  return (
    <>
      <section className="px-5 py-5 lg:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={selected.displayName} url={selected.avatarUrl} seed={selected.githubHandle || selected.id} className="size-16 shrink-0 rounded-xl border-border/80" />
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">selected operator</p>
                <h3 className="mt-1.5 text-[2rem] font-medium tracking-[-0.06em] leading-none">{selected.displayName}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <a
                    href={selected.githubUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
                  >
                    <GithubMarkIcon className="size-3.5 shrink-0" />
                    <span>{selected.githubHandle}</span>
                  </a>
                  {selected.xHandle && selected.xUrl ? (
                    <>
                      <span className="text-muted-foreground/35">·</span>
                      <a
                        href={selected.xUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
                      >
                        <XMarkIcon className="size-3.5 shrink-0" />
                        <span>{selected.xHandle}</span>
                      </a>
                    </>
                  ) : null}
                  <span className="text-muted-foreground/35">·</span>
                  <span>top model {selected.topModel}</span>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="rounded-sm px-2.5 py-1 text-[11px]">rank #{selected.rank}</Badge>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="border border-border/70 bg-muted/20 p-3.5">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">{metric}</div>
              <div className="mt-2.5 text-[2rem] font-medium tracking-[-0.06em]">{formatCompact(selected.metricValue)}</div>
            </div>
            <div
              className={cn(
                'border p-3.5',
                selected.growth > 0 && 'border-emerald-500/20 bg-emerald-500/8',
                selected.growth < 0 && 'border-rose-500/20 bg-rose-500/8',
                selected.growth === 0 && 'border-border/70 bg-muted/20',
              )}
            >
              <div
                className={cn(
                  'font-mono text-xs uppercase tracking-[0.22em]',
                  selected.growth > 0 && 'text-emerald-600 dark:text-emerald-400',
                  selected.growth < 0 && 'text-rose-600 dark:text-rose-400',
                  selected.growth === 0 && 'text-muted-foreground',
                )}
              >
                growth
              </div>
              <div
                className={cn(
                  'mt-2.5 text-[2rem] font-medium tracking-[-0.06em]',
                  selected.growth > 0 && 'text-emerald-700 dark:text-emerald-300',
                  selected.growth < 0 && 'text-rose-700 dark:text-rose-300',
                )}
              >
                {formatPercent(selected.growth)}
              </div>
            </div>
            <div className="border border-border/70 bg-muted/20 p-3.5">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">updated</div>
              <div className="mt-2.5 text-[1.05rem] font-medium tracking-[-0.04em]">{formatUpdatedAt(selected.lastSubmitted)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-5 lg:px-6">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">model breakdown</p>
            <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Top models</h4>
          </div>
          <Badge variant="muted" className="rounded-sm px-2 py-0.5 text-[11px]">{metric}</Badge>
        </div>
        <div className="space-y-3.5">
          {selectedModels.map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="font-mono">{formatNumber(item.value)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none">
                <div
                  className="right-panel-bar h-full origin-left rounded-full bg-foreground opacity-90 transition-[width,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none"
                  style={{ width: `${Math.max(5, item.percent * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 py-5 lg:px-6">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">traffic composition</p>
            <h4 className="mt-1 text-xl font-medium tracking-[-0.04em]">Token split</h4>
          </div>
          <Badge variant="muted" className="rounded-sm px-2 py-0.5 text-[11px]">{formatWindowLabel(windowDays)} view</Badge>
        </div>
        <div className="space-y-3.5">
          {selectedProviderBars.map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-mono">{formatNumber(item.value)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none">
                <div
                  className="right-panel-bar h-full origin-left rounded-full bg-foreground opacity-90 transition-[width,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none"
                  style={{ width: `${Math.max(4, item.percent * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default function App() {
  const pageStateCacheRef = useRef(new Map<string, PageViewState>());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const [metric, setMetric] = useState<MetricKey>('total');
  const [windowDays, setWindowDays] = useState<WindowKey>(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [theme, setTheme] = useState<ThemeKey>(getThemePreference);
  const [currentPage, setCurrentPage] = useState(0);
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const rightPanelScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileDetailScrollRef = useRef<HTMLDivElement | null>(null);
  const previousCacheKeyRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');

    try {
      window.localStorage.setItem('sloparena-theme', theme);
    } catch {
      // Ignore storage access issues; theme still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewport);
      return () => mediaQuery.removeEventListener('change', updateViewport);
    }

    mediaQuery.addListener(updateViewport);
    return () => mediaQuery.removeListener(updateViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileDetailsOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isMobileDetailsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileDetailsOpen]);

  useEffect(() => {
    if (!isMobileDetailsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileDetailsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileDetailsOpen]);

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
        const payload = normalizeDashboardData(await response.json());
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
          id: asString(user.userId, user.profile.providerUserId),
          rank: 0,
          displayName: asString(user.profile.displayName, user.profile.handle || 'Unknown builder'),
          githubHandle: displayHandle(user.profile.handle),
          githubUrl: asUrl(user.profile.profileUrl) ?? githubHandleToUrl(user.profile.handle),
          xHandle: user.profile.xHandle ? displayHandle(user.profile.xHandle) : undefined,
          xUrl: xHandleToUrl(user.profile.xHandle),
          avatarUrl: asUrl(user.profile.avatarUrl),
          machines: asPositiveInteger(user.machines, 0),
          activityDays: asPositiveInteger(summary.activityDays, 0),
          lastSubmitted: asIsoDate(user.lastSubmitted, data.generatedAt),
          topModel: asString(summary.byModel[0]?.model, 'No model fingerprint yet'),
          metricValue: metricValue(summary.totals, metric),
          totals: normalizeTotals(summary.totals),
          summary,
          growth: Number.isFinite(growthForUser(user, provider)) ? growthForUser(user, provider) : 0,
        };
      })
      .filter((row): row is LeaderboardRow => Boolean(row))
      .sort((left, right) => right.metricValue - left.metricValue || right.totals.total - left.totals.total || left.displayName.localeCompare(right.displayName))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, [data, metric, provider, windowDays]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(rows.length / PAGE_ROW_LIMIT)), [rows.length]);
  const pageRows = useMemo(() => rows.slice(currentPage * PAGE_ROW_LIMIT, (currentPage + 1) * PAGE_ROW_LIMIT), [currentPage, rows]);
  const visibleRows = useMemo(() => pageRows.slice(0, Math.min(visibleCount, pageRows.length)), [pageRows, visibleCount]);
  const cacheKey = useMemo(() => `${metric}:${windowDays}:${provider}:${currentPage}`, [currentPage, metric, provider, windowDays]);

  useEffect(() => {
    setCurrentPage(0);
  }, [metric, provider, windowDays, data]);

  useEffect(() => {
    const previousKey = previousCacheKeyRef.current;
    if (previousKey && previousKey !== cacheKey) {
      pageStateCacheRef.current.set(previousKey, {
        visibleCount,
        selectedUserId,
        scrollY: window.scrollY,
      });
    }

    const cached = pageStateCacheRef.current.get(cacheKey);
    if (cached) {
      setVisibleCount(Math.min(Math.max(ROW_CHUNK_SIZE, cached.visibleCount), Math.max(ROW_CHUNK_SIZE, pageRows.length)));
      setSelectedUserId(cached.selectedUserId);
      window.setTimeout(() => window.scrollTo({ top: cached.scrollY, behavior: 'auto' }), 0);
    } else {
      setVisibleCount(Math.min(ROW_CHUNK_SIZE, Math.max(ROW_CHUNK_SIZE, pageRows.length)));
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 0);
    }

    previousCacheKeyRef.current = cacheKey;
  }, [cacheKey, pageRows.length]);

  useEffect(() => {
    if (!pageRows.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !pageRows.some((row) => row.id === selectedUserId)) {
      setSelectedUserId(pageRows[0].id);
    }
  }, [pageRows, selectedUserId]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      pageStateCacheRef.current.set(cacheKey, {
        visibleCount,
        selectedUserId,
        scrollY: window.scrollY,
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [cacheKey, selectedUserId, visibleCount]);

  useLayoutEffect(() => {
    if (!rightPanelScrollRef.current) return;
    rightPanelScrollRef.current.scrollTop = 0;
    rightPanelScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedUserId, currentPage, metric, provider, windowDays]);

  useLayoutEffect(() => {
    if (!mobileDetailScrollRef.current || !isMobileDetailsOpen) return;
    mobileDetailScrollRef.current.scrollTop = 0;
    mobileDetailScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
  }, [isMobileDetailsOpen, selectedUserId, currentPage, metric, provider, windowDays]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    if (visibleRows.length >= pageRows.length || visibleRows.length >= PAGE_ROW_LIMIT) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || isLoadingMore) return;
        setIsLoadingMore(true);
        window.setTimeout(() => {
          setVisibleCount((current) => Math.min(current + ROW_CHUNK_SIZE, Math.min(pageRows.length, PAGE_ROW_LIMIT)));
          setIsLoadingMore(false);
        }, 350);
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isLoadingMore, pageRows.length, visibleRows.length]);

  const selected = pageRows.find((row) => row.id === selectedUserId) ?? pageRows[0] ?? null;

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
  const maxMetricValue = useMemo(() => pageRows[0]?.metricValue || 1, [pageRows]);
  const isInitialLoading = loading && !data;

  function handleRowSelect(rowId: string) {
    setSelectedUserId(rowId);
    if (isMobileViewport) {
      setIsMobileDetailsOpen(true);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.07),_transparent_35%),linear-gradient(to_bottom,_transparent,_rgba(0,0,0,0.04))] dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.045),_transparent_32%),linear-gradient(to_bottom,_transparent,_rgba(255,255,255,0.02))]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-0 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-3 pb-8">
          <div className="inline-flex min-w-0 items-center gap-3 text-sm font-medium leading-none">
            <img src={logoUrl} alt="SlopArena logo" className="block size-10 shrink-0 self-center rounded-sm bg-background object-contain object-center p-0.5" />
            <span className="self-center leading-none">SlopArena</span>
          </div>
          <div className="flex items-center gap-2">
            <RepoStarButton />
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-foreground shadow-none outline-none ring-0 transition-opacity hover:opacity-70"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunMedium className="size-5" /> : <MoonStar className="size-5" />}
            </button>
          </div>
        </header>

        <section className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
          <Badge variant="muted" className="rounded-sm px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase">
            cli-native leaderboard · github-verified
          </Badge>
          <h1 className="mt-6 max-w-5xl text-balance font-sans text-5xl font-medium tracking-[-0.08em] sm:text-6xl lg:text-8xl">
            Welcome to the Slop Arena
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
            Publish your Claude Code and Codex receipts from the terminal, get ranked in public, and watch who is actually carrying the token economy.
          </p>

          <div className="mt-10 flex w-full max-w-3xl items-stretch gap-2 sm:gap-3">
            <div className="relative min-w-0 flex-1">
              <Terminal className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input readOnly value={COMMAND} className="h-12 rounded-sm pl-11 font-mono text-sm" aria-label="Command to join the SlopArena leaderboard" />
            </div>
            <CopyCommandButton command={COMMAND} />
          </div>

        </section>

        <section className="mt-14 rounded-sm border border-border/80 bg-card/80 backdrop-blur lg:overflow-visible overflow-hidden">
          <div className="grid items-start lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
            <div>
              <div className="flex flex-col gap-5 border-b border-border/70 px-6 py-5">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-[2rem] font-medium tracking-[-0.06em]">{windowDays === 1 ? "Today's Winners" : 'Leaderboard'}</h2>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center self-center border-0 bg-transparent p-0 text-foreground shadow-none outline-none ring-0 transition-opacity hover:opacity-70 disabled:opacity-40"
                    onClick={() => setReloadTick((value) => value + 1)}
                    disabled={loading}
                    aria-label={loading ? 'Refreshing leaderboard data' : 'Refresh leaderboard data'}
                    title={loading ? 'Refreshing leaderboard data' : 'Refresh leaderboard data'}
                  >
                    <RefreshCw className={cn('size-4 stroke-[2.2]', loading && 'animate-spin')} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:items-end">
                  <label className="flex flex-col gap-1">
                    <span className="window-filter-title flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                      <span>Window</span>
                    </span>
                    <span className="window-filter-spotlight relative">
                      <select
                        value={windowDays}
                        onChange={(event) => setWindowDays(Number(event.target.value) as WindowKey)}
                        aria-label="Leaderboard time window"
                        className="window-filter-select h-10 min-w-0 w-full appearance-none rounded-sm border border-border bg-background px-3.5 pr-9 text-sm outline-none ring-0 transition focus:border-ring"
                      >
                        {windows.map((item) => (
                          <option key={item} value={item}>
                            {formatWindowLabel(item)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="window-filter-chevron pointer-events-none absolute right-3 top-1/2 size-4" />
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Metric</span>
                    <span className="relative">
                      <select
                        value={metric}
                        onChange={(event) => setMetric(event.target.value as MetricKey)}
                        aria-label="Leaderboard metric"
                        className="h-10 min-w-0 w-full appearance-none rounded-sm border border-border bg-background px-3.5 pr-9 text-sm outline-none ring-0 transition focus:border-ring"
                      >
                        {metrics.map((item) => (
                          <option key={item} value={item}>
                            {item[0].toUpperCase() + item.slice(1)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Provider</span>
                    <span className="relative">
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value as ProviderId | 'all')}
                        aria-label="Leaderboard provider filter"
                        className="h-10 min-w-0 w-full appearance-none rounded-sm border border-border bg-background px-3.5 pr-9 text-sm outline-none ring-0 transition focus:border-ring"
                      >
                        {providers.map((item) => (
                          <option key={item} value={item}>
                            {item === 'all' ? 'All providers' : item}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </span>
                  </label>

                </div>
              </div>

              {error ? (
                <div className="border-b border-border/70 bg-destructive/5 px-6 py-3 text-sm text-destructive">
                  <p className="font-medium">Couldn’t load the leaderboard.</p>
                  <p className="mt-0.5 text-destructive/90">Try Refresh in a few seconds.</p>
                </div>
              ) : null}

              <div aria-busy={isInitialLoading}>
                {isInitialLoading ? (
                  <div>
                    {Array.from({ length: ROW_CHUNK_SIZE }).map((_, index) => (
                      <LeaderboardRowSkeleton key={index} index={index} />
                    ))}
                  </div>
                ) : null}

                {rows.length === 0 && !loading ? (
                  <div className="px-6 py-8 text-center">
                    <p className="text-base font-medium">No snapshots on the board yet.</p>
                    <p className="mt-2 text-sm text-muted-foreground">Run the command above to publish the first one.</p>
                  </div>
                ) : null}

                {!isInitialLoading && visibleRows.map((row, index) => {
                  const positive = row.growth > 0;
                  const negative = row.growth < 0;
                  const selectedRow = selectedUserId === row.id;
                  const barPercent = Math.max(0.08, maxMetricValue > 0 ? row.metricValue / maxMetricValue : 0);

                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowSelect(row.id)}
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleRowSelect(row.id);
                        }
                      }}
                      className={cn(
                        'group grid w-full transform-gpu grid-cols-[minmax(0,1fr),280px] items-center gap-4 px-6 py-2.5 text-left transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:translate-x-[2px] hover:-translate-y-px hover:bg-accent/10 active:translate-x-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none',
                        index > 0 && 'border-t border-border/70',
                        selectedRow && 'bg-accent/14 hover:bg-accent/14',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2 overflow-visible">
                        <span className="inline-flex w-9 shrink-0 items-center justify-start font-mono text-[18px] leading-none text-foreground transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none">{rankGlyph(row.rank)}</span>
                        <Avatar name={row.displayName} url={row.avatarUrl} seed={row.githubHandle || row.id} className="size-10 rounded-xl border-border/80 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none" />
                        <div className="min-w-0 font-mono transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none">
                          <div className="grid min-w-0 gap-y-1 overflow-hidden text-[13px] leading-none min-[420px]:flex min-[420px]:items-center min-[420px]:gap-2 min-[420px]:gap-y-0">
                            <a
                              href={row.githubUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(event) => event.stopPropagation()}
                              className="flex min-w-0 items-center gap-1 font-medium text-foreground transition-opacity hover:opacity-70"
                            >
                              <GithubMarkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{row.githubHandle.replace(/^@/, '')}</span>
                            </a>
                            <span className="hidden shrink-0 text-muted-foreground/35 min-[420px]:inline">·</span>
                            {row.xHandle && row.xUrl ? (
                              <a
                                href={row.xUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(event) => event.stopPropagation()}
                                className="flex min-w-0 items-center gap-1 text-muted-foreground transition-opacity hover:opacity-70"
                              >
                                <XMarkIcon className="size-3.5 shrink-0" />
                                <span className="truncate">{row.xHandle.replace(/^@/, '')}</span>
                              </a>
                            ) : (
                              <span className="flex min-w-0 items-center gap-1 text-muted-foreground/70">
                                <XMarkIcon className="size-3.5 shrink-0" />
                                <span className="truncate">not linked</span>
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] leading-none text-muted-foreground/90">
                            <span className="truncate">{row.topModel}</span>
                            <span className="shrink-0 text-muted-foreground/35">·</span>
                            <span className="shrink-0">{row.activityDays}d</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col gap-1.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-baseline gap-2 font-mono">
                            <span className="text-[17px] font-semibold leading-none tracking-[-0.03em] text-foreground">{formatNumber(row.metricValue)}</span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80">tokens</span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5">
                            {positive ? (
                              <ArrowUpRight className="size-4 text-emerald-500" />
                            ) : negative ? (
                              <ArrowDownRight className="size-4 text-rose-500" />
                            ) : (
                              <div className="size-4" />
                            )}
                            <span
                              className={cn(
                                'text-[15px] leading-none tracking-[-0.03em]',
                                positive && 'text-emerald-500',
                                negative && 'text-rose-500',
                                !positive && !negative && 'text-muted-foreground',
                              )}
                            >
                              {formatPercent(row.growth).replace(/^\+/, '')}
                            </span>
                          </div>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:bg-muted motion-reduce:transition-none">
                          <div
                            className={cn(
                              'h-full origin-left rounded-full bg-foreground transition-[width,transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-[1.015] group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none',
                              selectedRow ? 'bg-primary opacity-100' : 'opacity-90',
                            )}
                            style={{ width: `${Math.min(100, barPercent * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {pageRows.length > visibleRows.length ? (
                  <div ref={loadMoreRef} className="border-t border-border/70 px-6 py-4">
                    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                      <span>Loaded {visibleRows.length} of {pageRows.length} rows on this page.</span>
                      <span className="font-mono">Fetching next 10…</span>
                    </div>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
                      <div className="h-full w-1/3 rounded-full bg-foreground/70 animate-pulse" />
                    </div>
                  </div>
                ) : null}

                {rows.length > PAGE_ROW_LIMIT ? (
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 px-6 py-4 text-sm">
                    <div className="text-muted-foreground">
                      Page {currentPage + 1} of {pageCount}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-sm px-3"
                        onClick={() => {
                          setCurrentPage((page) => Math.max(0, page - 1));
                        }}
                        disabled={currentPage === 0}
                      >
                        Previous 100
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-sm px-3"
                        onClick={() => {
                          setCurrentPage((page) => Math.min(pageCount - 1, page + 1));
                        }}
                        disabled={currentPage >= pageCount - 1}
                      >
                        Next 100
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="hidden border-t border-border/70 lg:sticky lg:top-0 lg:block lg:self-start lg:border-t-0 lg:border-l lg:border-border/70">
              <div
                key={selected ? `${selected.id}:${currentPage}:${metric}:${provider}:${windowDays}` : `empty:${currentPage}:${metric}:${provider}:${windowDays}`}
                ref={rightPanelScrollRef}
                className="hide-scrollbar divide-y divide-border/70 lg:max-h-screen lg:overflow-y-auto"
                aria-busy={isInitialLoading}
              >
                <SelectedPanelContent
                  selected={selected}
                  metric={metric}
                  windowDays={windowDays}
                  selectedProviderBars={selectedProviderBars}
                  selectedModels={selectedModels}
                  loading={isInitialLoading}
                />
              </div>
            </div>
          </div>
        </section>

        <div
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background lg:hidden transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            isMobileDetailsOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none',
          )}
          aria-hidden={!isMobileDetailsOpen}
        >
          <div className="flex items-center border-b border-border/70 px-4 py-3">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
              onClick={() => setIsMobileDetailsOpen(false)}
              aria-label="Go back to leaderboard"
            >
              <ArrowLeft className="size-4" />
              <span>Back</span>
            </button>
          </div>
          <div
            key={selected ? `mobile:${selected.id}:${currentPage}:${metric}:${provider}:${windowDays}` : `mobile-empty:${currentPage}:${metric}:${provider}:${windowDays}`}
            ref={mobileDetailScrollRef}
            className="hide-scrollbar flex-1 overflow-y-auto divide-y divide-border/70"
            aria-busy={isInitialLoading}
          >
            <SelectedPanelContent
              selected={selected}
              metric={metric}
              windowDays={windowDays}
              selectedProviderBars={selectedProviderBars}
              selectedModels={selectedModels}
              loading={isInitialLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
