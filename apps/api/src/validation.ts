import type {
  DailyUsage,
  ModelUsage,
  ProviderId,
  ProviderSnapshot,
  SnapshotDraft,
  SubmitSnapshotRequest,
  TokenTotals,
} from "@sloparena/shared";

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.trim().length <= maxLength;
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "claude" || value === "codex";
}

function normalizeXHandle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/^@+/, "");
  if (!normalized) {
    return undefined;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : undefined;
}

function parseTokenTotals(value: unknown): TokenTotals | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (![candidate.input, candidate.output, candidate.cache, candidate.total].every(isNumber)) {
    return null;
  }

  return {
    input: candidate.input as number,
    output: candidate.output as number,
    cache: candidate.cache as number,
    total: candidate.total as number,
  };
}

function parseModelUsage(value: unknown): ModelUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const totals = parseTokenTotals(candidate.tokens);
  if (!isSafeString(candidate.model, 120) || !totals) {
    return null;
  }

  return { model: candidate.model, tokens: totals };
}

function parseDailyUsage(value: unknown): DailyUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const totals = parseTokenTotals(candidate.totals);
  if (
    !isSafeString(candidate.date, 10) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ||
    !totals ||
    !Array.isArray(candidate.models) ||
    candidate.models.length > 300
  ) {
    return null;
  }

  return {
    date: candidate.date,
    totals,
    models: candidate.models.map(parseModelUsage).filter(Boolean) as ModelUsage[],
    displayValue: isNumber(candidate.displayValue) ? candidate.displayValue : undefined,
  };
}

function parseProviderSnapshot(value: unknown): ProviderSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const totals = parseTokenTotals(candidate.totals);
  if (
    !isProviderId(candidate.provider) ||
    !totals ||
    !Array.isArray(candidate.byModel) ||
    candidate.byModel.length > 300 ||
    !Array.isArray(candidate.byDay) ||
    candidate.byDay.length > 400
  ) {
    return null;
  }

  return {
    provider: candidate.provider,
    totals,
    byModel: candidate.byModel.map(parseModelUsage).filter(Boolean) as ModelUsage[],
    byDay: candidate.byDay.map(parseDailyUsage).filter(Boolean) as DailyUsage[],
    sourceCount: isNumber(candidate.sourceCount) ? candidate.sourceCount : 0,
    activityDays: isNumber(candidate.activityDays) ? candidate.activityDays : 0,
  };
}

function parseSnapshotDraft(value: unknown): SnapshotDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    !isSafeString(candidate.id, 120) ||
    !isSafeString(candidate.machineId, 120) ||
    !isSafeString(candidate.capturedAt, 64) ||
    !isSafeString(candidate.submittedAt, 64) ||
    !isSafeString(candidate.cliVersion, 32) ||
    !isNumber(candidate.windowDays) ||
    candidate.windowDays < 1 ||
    candidate.windowDays > 365 ||
    !Array.isArray(candidate.providers) ||
    candidate.providers.length === 0 ||
    candidate.providers.length > 2
  ) {
    return null;
  }

  const providers = candidate.providers.map(parseProviderSnapshot).filter(Boolean) as ProviderSnapshot[];
  if (providers.length === 0 || new Set(providers.map((provider) => provider.provider)).size !== providers.length) {
    return null;
  }

  return {
    id: candidate.id,
    machineId: candidate.machineId,
    capturedAt: candidate.capturedAt,
    submittedAt: candidate.submittedAt,
    windowDays: candidate.windowDays,
    cliVersion: candidate.cliVersion,
    providers,
  };
}

export function parseSubmitRequest(value: unknown): SubmitSnapshotRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const snapshot = parseSnapshotDraft(candidate.snapshot);
  const normalizedXHandle = normalizeXHandle(candidate.xHandle);
  const hasXHandle = candidate.xHandle === undefined || candidate.xHandle === null || typeof candidate.xHandle === "string";

  if (!isSafeString(candidate.githubAccessToken, 5000) || !snapshot || !hasXHandle || (candidate.xHandle && !normalizedXHandle)) {
    return null;
  }

  return {
    githubAccessToken: candidate.githubAccessToken,
    xHandle: normalizedXHandle,
    snapshot,
  };
}
