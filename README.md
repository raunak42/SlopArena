# SlopArena

A small full-stack MVP for tracking local Claude Code and Codex usage and publishing snapshots to a shared leaderboard.

The API now stores leaderboard data in Neon Postgres instead of a local JSON file.

## What is included

- `packages/cli`: the `sloparena` CLI scans local Claude/Codex logs, logs in with GitHub device flow, and submits snapshots
- `apps/api`: Express API with a file-backed snapshot store that verifies GitHub identity on submission
- `apps/web`: React/Vite leaderboard UI with switches for provider, metric, and leaderboard mode, plus a small production static server for Railway

## Required environment variables

Set these before starting the app:

```bash
export GITHUB_CLIENT_ID="..."
export NEON_DATABASE_URL="postgresql://..."
```

Create a GitHub OAuth app, enable **Device Flow**, and use its client ID here.

For Neon, create a project and copy the connection string from the Neon dashboard. The API will auto-create the `usage_snapshots` table on boot.

## Commands

Local development still uses:

```bash
npm run join
```

The published CLI will use the Railway backend by default. One thing still needs to be updated after you deploy the frontend: the CLI default leaderboard URL currently points to `https://sloparena.com` as a placeholder.

Install and build:

```bash
npm install
npm run build
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
- Local terminal login is stored in `~/.usageboard/auth.json`.
- The leaderboard shows verified GitHub identity and an optional user-supplied X handle.
- The CLI production API default is `https://usageboard-api-production.up.railway.app`.
- The CLI production web default is currently a placeholder: `https://sloparena.com`.
