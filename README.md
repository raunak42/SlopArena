# SlopArena

A small full-stack MVP for tracking local Claude Code and Codex usage and publishing snapshots to a shared leaderboard.

Inspired by [`slopmeter`](https://github.com/JeanMeijer/slopmeter) by Jean Meijer. SlopArena uses its own code and parsers, but the original repo was a great reference point for the local-usage-tracking approach.

The API now stores leaderboard data in Neon Postgres instead of a local JSON file.

## What is included

- `packages/cli`: the `sloparena` CLI scans local Claude/Codex logs, logs in with GitHub device flow, and submits snapshots
- `apps/api`: Express API backed by Neon Postgres that verifies GitHub identity on submission
- `apps/web`: React/Vite leaderboard UI with switches for provider, metric, and leaderboard mode, plus a small production static server for Railway

## Required environment variables

Set these before starting the app:

```bash
export NEON_DATABASE_URL="postgresql://..."
```

The published CLI already includes the public GitHub client ID by default, so you do not need `GITHUB_CLIENT_ID` for normal CLI usage.

For Neon, create a project and copy the connection string from the Neon dashboard. The API will auto-create the `usage_snapshots` table on boot.

## Commands

Local development still uses:

```bash
npm run join
```

The published CLI will use the Railway backend and Railway frontend by default.

Install and build:

```bash
npm install
npm run build
```

Railway-friendly service commands:

```bash
npm run build:api
npm run start:api
npm run build:web
npm run start:web
```

Run the API and website in development:

```bash
npm run dev
```

Log in from the terminal:

```bash
node packages/cli/dist/index.js login --server http://localhost:4000
node packages/cli/dist/index.js whoami
```

Set or clear an optional X handle:

```bash
node packages/cli/dist/index.js profile --x-handle raunak42
node packages/cli/dist/index.js profile --clear-x-handle
```

Scan local usage:

```bash
node packages/cli/dist/index.js scan --days 30
node packages/cli/dist/index.js scan --days 30 --json
```

Submit a snapshot:

```bash
node packages/cli/dist/index.js submit --server http://localhost:4000 --days 30
```

Log out locally:

```bash
node packages/cli/dist/index.js logout
```

## Data sources

- Claude Code: `~/.config/claude`, `~/.claude`, or `CLAUDE_CONFIG_DIR`
- Codex: `~/.codex` or `CODEX_HOME`

## Notes

- The API stores every submission in Neon Postgres (`usage_snapshots` table).
- The leaderboard aggregates the latest snapshot per `userId + machineId`, so re-submitting from the same machine updates the board instead of double counting.
- The frontend refreshes dashboard data every 15 seconds.
- Local terminal login is stored in `~/.sloparena/auth.json`.
- The leaderboard shows verified GitHub identity and an optional user-supplied X handle.
- The CLI production API default is `https://usageboard-api-production.up.railway.app`.
- For Railway, prefer stable root scripts instead of workspace names in the dashboard:
  - API build: `npm run build:api`
  - API start: `npm run start:api`
  - Web build: `npm run build:web`
  - Web start: `npm run start:web`
- The CLI production web default is `https://sloparena.up.railway.app`.
