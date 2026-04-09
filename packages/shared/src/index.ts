export type ProviderId = "claude" | "codex";

export interface TokenTotals {
  input: number;
  output: number;
  cache: number;
  total: number;
}

export interface ModelUsage {
  model: string;
  tokens: TokenTotals;
}

export interface DailyUsage {
  date: string;
  totals: TokenTotals;
  models: ModelUsage[];
  displayValue?: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  totals: TokenTotals;
  byModel: ModelUsage[];
  byDay: DailyUsage[];
  sourceCount: number;
  activityDays: number;
}

export interface PublicProfile {
  provider: "github";
  providerUserId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  profileUrl: string;
  xHandle?: string;
}

export interface UsageSnapshot {
  id: string;
  userId: string;
  machineId: string;
  capturedAt: string;
  submittedAt: string;
  windowDays: number;
  cliVersion: string;
  profile: PublicProfile;
  providers: ProviderSnapshot[];
}

export interface SnapshotDraft {
  id: string;
  machineId: string;
  capturedAt: string;
  submittedAt: string;
  windowDays: number;
  cliVersion: string;
  providers: ProviderSnapshot[];
}

export interface SubmitSnapshotRequest {
  githubAccessToken: string;
  xHandle?: string;
  snapshot: SnapshotDraft;
}

export interface LocalAuthSession {
  githubAccessToken: string;
  serverUrl: string;
  profile: PublicProfile;
  savedAt: string;
}

export interface UserAggregate {
  userId: string;
  profile: PublicProfile;
  machines: number;
  lastSubmitted: string;
  providers: ProviderSnapshot[];
}

export interface DashboardData {
  generatedAt: string;
  historyCount: number;
  activeUsers: number;
  activeMachines: number;
  users: UserAggregate[];
  recentSubmissions: UsageSnapshot[];
}

export function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cache: 0, total: 0 };
}

export function addTotals(target: TokenTotals, source: TokenTotals): TokenTotals {
  target.input += source.input;
  target.output += source.output;
  target.cache += source.cache;
  target.total += source.total;
  return target;
}

export function cloneTotals(source: TokenTotals): TokenTotals {
  return {
    input: source.input,
    output: source.output,
    cache: source.cache,
    total: source.total,
  };
}

export function sortModelUsage(items: ModelUsage[]): ModelUsage[] {
  return [...items].sort((left, right) => right.tokens.total - left.tokens.total || left.model.localeCompare(right.model));
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
