import {
  addTotals,
  emptyTotals,
  sortModelUsage,
  type DailyUsage,
  type ModelUsage,
  type ProviderId,
  type ProviderSnapshot,
  type SnapshotDraft,
  type SubmitSnapshotRequest,
  type TokenTotals,
} from '@sloparena/shared';

const MAX_STRING_120 = 120;
const MAX_STRING_64 = 64;
const MAX_CLI_VERSION_LENGTH = 32;
const MAX_ACCESS_TOKEN_LENGTH = 5000;
const MAX_MODELS_PER_DAY = 300;
const MAX_DAYS_PER_PROVIDER = 400;
const MAX_PROVIDERS_PER_SNAPSHOT = 2;
const MAX_SOURCE_COUNT = 10000;
const ALLOWED_FUTURE_DAYS = 1;

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.trim().length <= maxLength;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'claude' || value === 'codex';
}

function normalizeXHandle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/^@+/, '');
  if (!normalized) {
    return undefined;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : undefined;
}

function isValidIsoDateTime(value: unknown): value is string {
  if (!isSafeString(value, MAX_STRING_64)) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function isValidDateKey(value: unknown): value is string {
  if (!isSafeString(value, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateWithinWindow(dateKey: string, windowDays: number): boolean {
  const target = new Date(`${dateKey}T00:00:00Z`);
  const latest = new Date();
  latest.setUTCHours(0, 0, 0, 0);
  latest.setUTCDate(latest.getUTCDate() + ALLOWED_FUTURE_DAYS);

  const earliest = new Date();
  earliest.setUTCHours(0, 0, 0, 0);
  earliest.setUTCDate(earliest.getUTCDate() - Math.max(windowDays - 1, 0) - ALLOWED_FUTURE_DAYS);

  return target.getTime() >= earliest.getTime() && target.getTime() <= latest.getTime();
}

function parseTokenTotals(value: unknown): TokenTotals | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (![candidate.input, candidate.output, candidate.cache, candidate.total].every(isNonNegativeSafeInteger)) {
    return null;
  }

  const input = candidate.input as number;
  const output = candidate.output as number;
  const cache = candidate.cache as number;
  const total = candidate.total as number;

  if (total < input || total < output || total < cache) {
    return null;
  }

  return { input, output, cache, total };
}

function parseModelUsage(value: unknown): ModelUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const totals = parseTokenTotals(candidate.tokens);
  if (!isSafeString(candidate.model, MAX_STRING_120) || !totals) {
    return null;
  }

  return { model: candidate.model, tokens: totals };
}

function parseDailyUsage(value: unknown, windowDays: number): DailyUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const totals = parseTokenTotals(candidate.totals);
  if (!isValidDateKey(candidate.date) || !isDateWithinWindow(candidate.date, windowDays) || !totals || !Array.isArray(candidate.models) || candidate.models.length > MAX_MODELS_PER_DAY) {
    return null;
  }

  const models = candidate.models.map(parseModelUsage);
  if (models.some((item) => !item)) {
    return null;
  }

  return {
    date: candidate.date,
    totals,
    models: models as ModelUsage[],
    displayValue: isNonNegativeSafeInteger(candidate.displayValue) ? candidate.displayValue : undefined,
  };
}

function rebuildProviderSnapshot(provider: ProviderId, byDay: DailyUsage[], sourceCount: number): ProviderSnapshot {
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

function parseProviderSnapshot(value: unknown, windowDays: number): ProviderSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isProviderId(candidate.provider) || !Array.isArray(candidate.byDay) || candidate.byDay.length > MAX_DAYS_PER_PROVIDER) {
    return null;
  }

  const byDay = candidate.byDay.map((item) => parseDailyUsage(item, windowDays));
  if (byDay.some((item) => !item)) {
    return null;
  }

  const parsedByDay = byDay as DailyUsage[];
  const uniqueDates = new Set(parsedByDay.map((item) => item.date));
  if (uniqueDates.size !== parsedByDay.length) {
    return null;
  }

  const sourceCount = isNonNegativeSafeInteger(candidate.sourceCount) && candidate.sourceCount <= MAX_SOURCE_COUNT
    ? candidate.sourceCount
    : 0;

  return rebuildProviderSnapshot(candidate.provider, parsedByDay, sourceCount);
}

function parseSnapshotDraft(value: unknown): SnapshotDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    !isSafeString(candidate.id, MAX_STRING_120) ||
    !isSafeString(candidate.machineId, MAX_STRING_120) ||
    !isValidIsoDateTime(candidate.capturedAt) ||
    !isValidIsoDateTime(candidate.submittedAt) ||
    !isSafeString(candidate.cliVersion, MAX_CLI_VERSION_LENGTH) ||
    !isNonNegativeSafeInteger(candidate.windowDays) ||
    candidate.windowDays < 1 ||
    candidate.windowDays > 365 ||
    !Array.isArray(candidate.providers) ||
    candidate.providers.length === 0 ||
    candidate.providers.length > MAX_PROVIDERS_PER_SNAPSHOT
  ) {
    return null;
  }

  const providers = candidate.providers.map((item) => parseProviderSnapshot(item, candidate.windowDays));
  if (providers.some((item) => !item)) {
    return null;
  }

  const parsedProviders = providers as ProviderSnapshot[];
  if (new Set(parsedProviders.map((provider) => provider.provider)).size !== parsedProviders.length) {
    return null;
  }

  return {
    id: candidate.id,
    machineId: candidate.machineId,
    capturedAt: candidate.capturedAt,
    submittedAt: candidate.submittedAt,
    windowDays: candidate.windowDays,
    cliVersion: candidate.cliVersion,
    providers: parsedProviders,
  };
}

export function parseSubmitRequest(value: unknown): SubmitSnapshotRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const snapshot = parseSnapshotDraft(candidate.snapshot);
  const normalizedXHandle = normalizeXHandle(candidate.xHandle);
  const hasXHandle = candidate.xHandle === undefined || candidate.xHandle === null || typeof candidate.xHandle === 'string';

  if (!isSafeString(candidate.githubAccessToken, MAX_ACCESS_TOKEN_LENGTH) || !snapshot || !hasXHandle || (candidate.xHandle && !normalizedXHandle)) {
    return null;
  }

  return {
    githubAccessToken: candidate.githubAccessToken,
    xHandle: normalizedXHandle,
    snapshot,
  };
}
