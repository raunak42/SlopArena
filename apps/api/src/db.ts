import postgres from 'postgres';
import {
  addTotals,
  emptyTotals,
  sortModelUsage,
  type DailyUsage,
  type ProviderId,
  type TokenTotals,
  type UsageSnapshot,
} from '@sloparena/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeTokenTotals(value: unknown): TokenTotals | null {
  if (!isRecord(value)) {
    return null;
  }

  const input = value.input;
  const output = value.output;
  const cache = value.cache;
  const total = value.total;

  if (
    !isNonNegativeSafeInteger(input) ||
    !isNonNegativeSafeInteger(output) ||
    !isNonNegativeSafeInteger(cache) ||
    !isNonNegativeSafeInteger(total) ||
    total < input ||
    total < output ||
    total < cache
  ) {
    return null;
  }

  return {
    input,
    output,
    cache,
    total,
  };
}

function normalizeTotalsForProvider(provider: ProviderId, totals: TokenTotals): TokenTotals {
  if (provider === 'claude' && totals.cache > 0 && totals.total === totals.input + totals.output) {
    const nonCacheTotal = Math.max(0, totals.total - totals.cache);
    const weightSum = totals.input + totals.output;
    const input = weightSum > 0 ? Math.round((totals.input / weightSum) * nonCacheTotal) : nonCacheTotal;
    const output = Math.max(0, nonCacheTotal - input);

    return {
      input,
      output,
      cache: totals.cache,
      total: input + output + totals.cache,
    };
  }

  if (provider === 'codex') {
    return {
      ...totals,
      total: Math.max(totals.total, totals.input + totals.output + totals.cache),
    };
  }

  return totals;
}

function normalizeModelUsage(value: unknown): { model: string; tokens: TokenTotals } | null {
  if (!isRecord(value)) {
    return null;
  }

  const tokens = normalizeTokenTotals(value.tokens);
  if (typeof value.model !== 'string' || value.model.trim().length === 0 || value.model.length > 120 || !tokens) {
    return null;
  }

  return { model: value.model, tokens };
}

function normalizeDailyUsage(value: unknown): DailyUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const totals = normalizeTokenTotals(value.totals);
  if (!isValidDateKey(value.date) || !totals || !Array.isArray(value.models) || value.models.length > 300) {
    return null;
  }

  const models = value.models.map(normalizeModelUsage);
  if (models.some((model) => !model)) {
    return null;
  }

  return {
    date: value.date,
    totals,
    models: models as Array<{ model: string; tokens: TokenTotals }>,
    displayValue: value.displayValue === undefined || isNonNegativeSafeInteger(value.displayValue) ? value.displayValue as number | undefined : undefined,
  };
}

function rebuildProviderSnapshot(provider: ProviderId, byDay: DailyUsage[], sourceCount: number) {
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
    byModel: sortModelUsage([...modelMap.entries()].map(([model, tokens]) => ({ model, tokens }))),
    byDay: [...byDay].sort((left, right) => left.date.localeCompare(right.date)),
    sourceCount,
    activityDays: byDay.filter((day) => day.totals.total > 0 || day.displayValue).length,
  };
}

function normalizeProviderSnapshot(value: unknown): { provider: ProviderId; byDay: DailyUsage[]; sourceCount: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  const provider = value.provider;
  if ((provider !== 'claude' && provider !== 'codex') || !Array.isArray(value.byDay) || value.byDay.length > 400) {
    return null;
  }

  const byDay = value.byDay.map(normalizeDailyUsage);
  if (byDay.some((day) => !day)) {
    return null;
  }

  return {
    provider,
    byDay: (byDay as DailyUsage[]).map((day) => ({
      ...day,
      totals: normalizeTotalsForProvider(provider, day.totals),
      models: day.models.map((model) => ({
        ...model,
        tokens: normalizeTotalsForProvider(provider, model.tokens),
      })),
    })),
    sourceCount: isNonNegativeSafeInteger(value.sourceCount) ? value.sourceCount : 0,
  };
}

function isPublicProfile(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.provider === 'github' &&
    typeof value.providerUserId === 'string' &&
    value.providerUserId.trim().length > 0 &&
    typeof value.handle === 'string' &&
    value.handle.trim().length > 0 &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    typeof value.profileUrl === 'string' &&
    value.profileUrl.trim().length > 0
  );
}

function normalizeStoredSnapshot(value: unknown): UsageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.machineId !== 'string' ||
    !isValidIsoDateTime(value.submittedAt) ||
    !isPublicProfile(value.profile) ||
    !Array.isArray(value.providers) ||
    value.providers.length === 0 ||
    value.providers.length > 2
  ) {
    return null;
  }

  const providers = value.providers.map(normalizeProviderSnapshot);

  if (providers.some((provider) => !provider)) {
    return null;
  }

  const parsedProviders = providers as Array<{
    provider: ProviderId;
    byDay: DailyUsage[];
    sourceCount: number;
  }>;

  if (new Set(parsedProviders.map((provider) => provider.provider)).size !== parsedProviders.length) {
    return null;
  }

  return {
    id: value.id,
    userId: value.userId,
    machineId: value.machineId,
    capturedAt: isValidIsoDateTime(value.capturedAt) ? value.capturedAt : value.submittedAt,
    submittedAt: value.submittedAt,
    windowDays: isNonNegativeSafeInteger(value.windowDays) ? value.windowDays : 365,
    cliVersion: typeof value.cliVersion === 'string' ? value.cliVersion : 'unknown',
    profile: {
      provider: 'github',
      providerUserId: value.profile.providerUserId as string,
      handle: value.profile.handle as string,
      displayName: value.profile.displayName as string,
      avatarUrl: typeof value.profile.avatarUrl === 'string' ? value.profile.avatarUrl : undefined,
      profileUrl: value.profile.profileUrl as string,
      xHandle: typeof value.profile.xHandle === 'string' ? value.profile.xHandle : undefined,
    },
    providers: parsedProviders.map((provider) => rebuildProviderSnapshot(provider.provider, provider.byDay, provider.sourceCount)),
  };
}

function parseStoredSnapshot(value: unknown): UsageSnapshot | null {
  const normalized = normalizeStoredSnapshot(value);
  if (normalized) {
    return normalized;
  }

  if (typeof value === 'string') {
    try {
      return normalizeStoredSnapshot(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  return null;
}

let sqlClient: postgres.Sql | null = null;

function getConnectionString(): string {
  const value = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('Missing NEON_DATABASE_URL (or DATABASE_URL). Add your Neon Postgres connection string before starting the API.');
  }
  return value;
}

function getSql(): postgres.Sql {
  if (!sqlClient) {
    sqlClient = postgres(getConnectionString(), {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return sqlClient;
}

export async function initDatabase(): Promise<void> {
  const sql = getSql();
  await sql`
    create table if not exists usage_snapshots (
      id text primary key,
      user_id text not null,
      machine_id text not null,
      submitted_at timestamptz not null,
      payload jsonb not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists usage_snapshots_user_machine_idx on usage_snapshots (user_id, machine_id, submitted_at desc)`;
  await sql`create index if not exists usage_snapshots_submitted_at_idx on usage_snapshots (submitted_at desc)`;
}

export async function listSnapshots(): Promise<UsageSnapshot[]> {
  const sql = getSql();
  const rows = await sql<{ payload: unknown }[]>`
    select payload
    from usage_snapshots
    order by submitted_at desc
  `;
  return rows
    .map((row) => parseStoredSnapshot(row.payload))
    .filter((row): row is UsageSnapshot => Boolean(row));
}

export async function insertSnapshot(snapshot: UsageSnapshot): Promise<void> {
  const sql = getSql();
  await sql`
    insert into usage_snapshots (id, user_id, machine_id, submitted_at, payload)
    values (${snapshot.id}, ${snapshot.userId}, ${snapshot.machineId}, ${snapshot.submittedAt}, ${sql.json(snapshot)})
    on conflict (id) do update
    set
      user_id = excluded.user_id,
      machine_id = excluded.machine_id,
      submitted_at = excluded.submitted_at,
      payload = excluded.payload
  `;
}

export async function pingDatabase(): Promise<void> {
  const sql = getSql();
  await sql`select 1`;
}
