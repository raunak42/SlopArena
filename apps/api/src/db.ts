import postgres from "postgres";
import type { UsageSnapshot } from "@sloparena/shared";

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
  const rows = await sql<{ payload: UsageSnapshot }[]>`
    select payload
    from usage_snapshots
    order by submitted_at desc
  `;
  return rows.map((row) => row.payload);
}

export async function insertSnapshot(snapshot: UsageSnapshot): Promise<void> {
  const sql = getSql();
  await sql`
    insert into usage_snapshots (id, user_id, machine_id, submitted_at, payload)
    values (${snapshot.id}, ${snapshot.userId}, ${snapshot.machineId}, ${snapshot.submittedAt}, ${JSON.stringify(snapshot)}::jsonb)
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
