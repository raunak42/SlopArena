import postgres from "postgres";
import type { UsageSnapshot } from "@sloparena/shared";

function isTokenTotals(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return [candidate.input, candidate.output, candidate.cache, candidate.total].every(
    (item) => typeof item === "number" && Number.isFinite(item),
  );
}

function isModelUsage(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.model === "string" && isTokenTotals(candidate.tokens);
}

function isDailyUsage(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.date === "string" &&
    isTokenTotals(candidate.totals) &&
    Array.isArray(candidate.models) &&
    candidate.models.every(isModelUsage) &&
    (candidate.displayValue === undefined || typeof candidate.displayValue === "number")
  );
}

function isProviderSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.provider === "claude" || candidate.provider === "codex") &&
    isTokenTotals(candidate.totals) &&
    Array.isArray(candidate.byModel) &&
    candidate.byModel.every(isModelUsage) &&
    Array.isArray(candidate.byDay) &&
    candidate.byDay.every(isDailyUsage) &&
    typeof candidate.sourceCount === "number" &&
    typeof candidate.activityDays === "number"
  );
}

function isPublicProfile(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.provider === "github" &&
    typeof candidate.providerUserId === "string" &&
    typeof candidate.handle === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.profileUrl === "string"
  );
}

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.machineId === "string" &&
    typeof candidate.submittedAt === "string" &&
    Array.isArray(candidate.providers) &&
    candidate.providers.every(isProviderSnapshot) &&
    isPublicProfile(candidate.profile)
  );
}

function parseStoredSnapshot(value: unknown): UsageSnapshot | null {
  if (isUsageSnapshot(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isUsageSnapshot(parsed) ? parsed : null;
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
    throw new Error("Missing NEON_DATABASE_URL (or DATABASE_URL). Add your Neon Postgres connection string before starting the API.");
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
