import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const root = '/home/raunak/usageboard';
loadEnvFile(path.join(root, '.env'));

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Missing NEON_DATABASE_URL or DATABASE_URL');
}

const sql = postgres(connectionString, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoAtUtc(daysAgo, hour) {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function totals(input, output, cache) {
  return { input, output, cache, total: input + output + cache };
}

function makeProvider(provider, models, profileIndex, scale, activityBias, recentBoost, cadence = 1) {
  const byDay = [];
  const modelTotals = new Map(models.map((model) => [model.name, totals(0, 0, 0)]));
  let providerTotals = totals(0, 0, 0);
  let activityDays = 0;

  for (let daysAgo = 364; daysAgo >= 0; daysAgo--) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysAgo);

    const dayIndex = 364 - daysAgo;
    const weekly = 0.78 + ((((dayIndex + profileIndex * 3) % 7) + 1) / 10);
    const monthly = 0.9 + ((((dayIndex + profileIndex * 5) % 29) + 1) / 100);
    const wave = 0.88 + ((Math.sin((dayIndex + profileIndex * 11) / 13) + 1) / 5);
    const recent = daysAgo <= 30 ? recentBoost : daysAgo <= 60 ? 0.92 : 1;
    const active = ((dayIndex + profileIndex) % cadence !== 0 ? 1 : 0) || daysAgo < 45;
    const intensity = active ? scale * weekly * monthly * wave * recent * activityBias : 0;

    const modelEntries = [];
    let dayInput = 0;
    let dayOutput = 0;
    let dayCache = 0;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const mix = model.mix;
      const modelPulse = 0.82 + ((((dayIndex + i * 9 + profileIndex * 4) % 17) + 1) / 20);
      const rawInput = Math.round(intensity * mix.input * modelPulse);
      const rawOutput = Math.round(intensity * mix.output * modelPulse * 0.72);
      const rawCache = Math.round(intensity * mix.cache * modelPulse * 0.94);
      const dayTotals = totals(rawInput, rawOutput, rawCache);

      if (dayTotals.total > 0) {
        modelEntries.push({ model: model.name, tokens: dayTotals });
        const aggregate = modelTotals.get(model.name);
        aggregate.input += dayTotals.input;
        aggregate.output += dayTotals.output;
        aggregate.cache += dayTotals.cache;
        aggregate.total += dayTotals.total;
        dayInput += dayTotals.input;
        dayOutput += dayTotals.output;
        dayCache += dayTotals.cache;
      }
    }

    const dayTotals = totals(dayInput, dayOutput, dayCache);
    if (dayTotals.total > 0) activityDays += 1;

    providerTotals.input += dayTotals.input;
    providerTotals.output += dayTotals.output;
    providerTotals.cache += dayTotals.cache;
    providerTotals.total += dayTotals.total;

    byDay.push({
      date: formatDateKey(date),
      totals: dayTotals,
      models: modelEntries.sort((a, b) => b.tokens.total - a.tokens.total || a.model.localeCompare(b.model)),
    });
  }

  return {
    provider,
    totals: providerTotals,
    byModel: [...modelTotals.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .filter((item) => item.tokens.total > 0)
      .sort((a, b) => b.tokens.total - a.tokens.total || a.model.localeCompare(b.model)),
    byDay,
    sourceCount: provider === 'claude' ? 1 : 2,
    activityDays,
  };
}

const fakeUsers = [
  { handle: 'stanbuilds', displayName: 'Stan Mercer', xHandle: 'stanbuilds', avatar: 'stan', scale: 1_750_000, activityBias: 1.08, recentBoost: 1.48, providers: ['claude', 'codex'] },
  { handle: 'trimcris', displayName: 'Cris Soto', xHandle: 'crisrx', avatar: 'cris', scale: 1_180_000, activityBias: 0.96, recentBoost: 0.78, providers: ['claude', 'codex'] },
  { handle: 'rezijacob', displayName: 'Jacob Jacquet', xHandle: 'jacobjacquet', avatar: 'jacob', scale: 965_000, activityBias: 0.88, recentBoost: 1.1, providers: ['claude'] },
  { handle: 'kibuops', displayName: 'Daniel Caridi', xHandle: 'danielcaridi', avatar: 'daniel', scale: 840_000, activityBias: 0.93, recentBoost: 1.36, providers: ['claude', 'codex'] },
  { handle: 'capturerobby', displayName: 'Robby Frank', xHandle: 'robbyfrank', avatar: 'robby', scale: 790_000, activityBias: 0.91, recentBoost: 1.05, providers: ['codex'] },
  { handle: 'cometgrant', displayName: 'Grant Cooper', xHandle: 'grantcoop', avatar: 'grant', scale: 735_000, activityBias: 0.9, recentBoost: 0.86, providers: ['claude', 'codex'] },
  { handle: 'shipfastmaya', displayName: 'Maya Chen', xHandle: 'mayaships', avatar: 'maya', scale: 690_000, activityBias: 0.94, recentBoost: 1.22, providers: ['claude'] },
  { handle: 'byteforgeleo', displayName: 'Leo Park', xHandle: 'leoforges', avatar: 'leo', scale: 620_000, activityBias: 0.84, recentBoost: 0.92, providers: ['codex', 'claude'] },
  { handle: 'neonivy', displayName: 'Ivy Brooks', xHandle: 'ivyloops', avatar: 'ivy', scale: 585_000, activityBias: 0.86, recentBoost: 1.57, providers: ['claude'] },
  { handle: 'grepmax', displayName: 'Max Rivera', xHandle: 'maxgrep', avatar: 'max', scale: 540_000, activityBias: 0.8, recentBoost: 1.28, providers: ['claude', 'codex'] },
];

const claudeModels = [
  { name: 'gpt-5.4', mix: { input: 0.58, output: 0.23, cache: 0.75 } },
  { name: 'claude-opus-4-6', mix: { input: 0.18, output: 0.12, cache: 0.09 } },
  { name: 'gpt-5.4-mini', mix: { input: 0.12, output: 0.08, cache: 0.05 } },
];

const codexModels = [
  { name: 'gpt-5.3-codex', mix: { input: 0.43, output: 0.2, cache: 0.17 } },
  { name: 'gpt-5.1-codex-mini', mix: { input: 0.13, output: 0.06, cache: 0.04 } },
];

const snapshots = fakeUsers.map((user, index) => {
  const providers = user.providers.map((provider) =>
    makeProvider(
      provider,
      provider === 'claude' ? claudeModels : codexModels,
      index + 1,
      user.scale * (provider === 'codex' ? 0.72 : 1),
      user.activityBias,
      user.recentBoost,
      provider === 'codex' ? 3 : 2,
    ),
  );

  return {
    id: `fake-snapshot-${user.handle}`,
    userId: `fake-user-${user.handle}`,
    machineId: `fake-machine-${user.handle}`,
    capturedAt: isoAtUtc(0, 10 + (index % 8)),
    submittedAt: isoAtUtc(index % 3, 11 + (index % 7)),
    windowDays: 365,
    cliVersion: '0.1.2',
    profile: {
      provider: 'github',
      providerUserId: `fake-gh-${1000 + index}`,
      handle: `@${user.handle}`,
      displayName: user.displayName,
      avatarUrl: `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.avatar)}`,
      profileUrl: `https://github.com/${user.handle}`,
      xHandle: user.xHandle,
    },
    providers,
  };
});

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

for (const snapshot of snapshots) {
  await sql`
    insert into usage_snapshots (id, user_id, machine_id, submitted_at, payload)
    values (${snapshot.id}, ${snapshot.userId}, ${snapshot.machineId}, ${snapshot.submittedAt}, ${sql.json(snapshot)})
    on conflict (id) do update
    set user_id = excluded.user_id,
        machine_id = excluded.machine_id,
        submitted_at = excluded.submitted_at,
        payload = excluded.payload
  `;
}

const countRow = await sql`select count(*)::int as count from usage_snapshots where id like 'fake-snapshot-%'`;
console.log(`Seeded ${snapshots.length} fake users. Fake snapshot rows now in DB: ${countRow[0].count}`);

await sql.end({ timeout: 5 });
