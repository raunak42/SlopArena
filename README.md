# SlopArena

<p align="center">
  <img src="./apps/web/src/assets/sloparena-logo.svg" alt="SlopArena logo" width="96" />
</p>

A CLI-first leaderboard for tracking local Claude Code and Codex usage and publishing snapshots to a public board.

Inspired by [`slopmeter`](https://github.com/JeanMeijer/slopmeter) by Jean Meijer. SlopArena uses its own code and parsers, but the original repo was a great reference point for the local-usage-tracking approach.

## For users

### Quick start

Run:

```bash
npx sloparena go
```

That flow will:
- open GitHub login in your browser
- optionally let you attach an X handle
- scan your local Claude Code and Codex logs
- submit your snapshot
- open the leaderboard

### Other CLI commands

```bash
npx sloparena help
npx sloparena login
npx sloparena whoami
npx sloparena profile
npx sloparena scan --days 365
npx sloparena submit --days 365
npx sloparena logout
```

### Data sources

SlopArena reads local usage from:
- Claude Code: `~/.config/claude`, `~/.claude`, or `CLAUDE_CONFIG_DIR`
- Codex: `~/.codex` or `CODEX_HOME`

### Notes

- Local login is stored in `~/.sloparena/auth.json`.
- The leaderboard shows verified GitHub identity and an optional user-supplied X handle.
- The published CLI uses the production backend and web app by default.
- Production web/API: `https://usageboard.vercel.app`

## For developers

### What is included

- `packages/cli`: the `sloparena` CLI for scanning local logs, authenticating with GitHub, and submitting snapshots
- `apps/api`: Express API backed by Neon Postgres
- `apps/web`: React/Vite leaderboard UI plus a small production static server for Railway
- `packages/shared`: shared types and aggregation helpers

### Required environment variables

Set these before starting the API locally:

```bash
export NEON_DATABASE_URL="postgresql://..."
```

For Neon, create a project and copy the connection string from the Neon dashboard. The API auto-creates the `usage_snapshots` table on boot.

The published CLI already includes the public GitHub client ID fallback, so normal end users do not need to set `GITHUB_CLIENT_ID`.

### Install and build

```bash
npm install
npm run build
```

### Local development

Run the API and website:

```bash
npm run dev
```

Run the guided local flow against local services:

```bash
npm run join
```

### Useful commands

Railway-friendly service commands:

```bash
npm run build:api
npm run start:api
npm run build:web
npm run start:web
```

CLI against local API:

```bash
node packages/cli/dist/index.js login --server http://localhost:4000
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js profile --x-handle raunak42
node packages/cli/dist/index.js profile --clear-x-handle
node packages/cli/dist/index.js scan --days 30
node packages/cli/dist/index.js scan --days 30 --json
node packages/cli/dist/index.js submit --server http://localhost:4000 --days 30
node packages/cli/dist/index.js logout
```

### Implementation notes

- The API stores every submission in Neon Postgres in the `usage_snapshots` table.
- The leaderboard aggregates the latest snapshot per `userId + machineId`, so re-submitting from the same machine updates the board instead of double counting on the leaderboard.
- The CLI production API default is `https://usageboard.vercel.app`.
- Vercel serves the Vite app and the Express API from the same deployment. API routes are exposed under `/api/*`.
- For Vercel, use the included `vercel.json`; the build command is `npm run build:web` and the output directory is `apps/web/dist`.
