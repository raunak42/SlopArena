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

function isProviderId(value: unknown): value is ProviderId {
  return value === "claude" || value === "codex";
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
  if (!isString(candidate.model) || !totals) {
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
  if (!isString(candidate.date) || !totals || !Array.isArray(candidate.models)) {
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
  if (!isProviderId(candidate.provider) || !totals || !Array.isArray(candidate.byModel) || !Array.isArray(candidate.byDay)) {
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
    !isString(candidate.id) ||
    !isString(candidate.machineId) ||
    !isString(candidate.capturedAt) ||
    !isString(candidate.submittedAt) ||
    !isString(candidate.cliVersion) ||
    !isNumber(candidate.windowDays) ||
    !Array.isArray(candidate.providers)
  ) {
    return null;
  }

  const providers = candidate.providers.map(parseProviderSnapshot).filter(Boolean) as ProviderSnapshot[];
  if (providers.length === 0) {
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
  const hasXHandle = candidate.xHandle === undefined || candidate.xHandle === null || typeof candidate.xHandle === "string";

  if (!isString(candidate.githubAccessToken) || !snapshot || !hasXHandle) {
    return null;
  }

  return {
    githubAccessToken: candidate.githubAccessToken,
    xHandle: typeof candidate.xHandle === "string" && candidate.xHandle.trim() !== "" ? candidate.xHandle.trim() : undefined,
    snapshot,
  };
}
