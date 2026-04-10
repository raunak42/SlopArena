import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('Missing NEON_DATABASE_URL (or DATABASE_URL).');
}

const sql = postgres(connectionString, { prepare: false });

const rows = await sql`
  select id, payload
  from usage_snapshots
  where jsonb_typeof(payload) = 'string'
`;

let fixed = 0;
for (const row of rows) {
  if (typeof row.payload !== 'string') {
    continue;
  }

  try {
    const parsed = JSON.parse(row.payload);
    await sql`
      update usage_snapshots
      set payload = ${sql.json(parsed)}
      where id = ${row.id}
    `;
    fixed += 1;
  } catch (error) {
    console.error(`Failed to repair row ${row.id}:`, error instanceof Error ? error.message : String(error));
  }
}

console.log(`Repaired ${fixed} row(s).`);
await sql.end({ timeout: 5 });
