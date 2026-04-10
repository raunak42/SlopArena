#!/usr/bin/env node
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ProviderId } from "@sloparena/shared";
import { submitSnapshot } from "./api.js";
import { loginWithGitHub, logoutLocalSession, requireLocalSession, updateXHandle } from "./auth.js";
import { openBrowser } from "./browser.js";
import { collectSnapshot } from "./collector.js";
import { getAuthFilePath, getDefaultMachineId, loadLocalSession } from "./utils.js";

const DEFAULT_API_URL = process.env.SLOPARENA_API_URL?.trim() || "https://sloparena-api-production.up.railway.app";
const DEFAULT_WEB_URL = process.env.SLOPARENA_WEB_URL?.trim() || "https://sloparena.up.railway.app";

interface ParsedArgs {
  command: "scan" | "submit" | "login" | "whoami" | "logout" | "profile" | "go" | "help";
  machineId?: string;
  server: string;
  web: string;
  days: number;
  providers: ProviderId[];
  json: boolean;
  xHandle?: string;
  clearXHandle: boolean;
}

function printHelp(): void {
  console.log(`sloparena

Commands:
  sloparena go [--server ${DEFAULT_API_URL}] [--web ${DEFAULT_WEB_URL}]
  sloparena login [--server ${DEFAULT_API_URL}]
  sloparena whoami
  sloparena profile [--x-handle raunak42] [--clear-x-handle]
  sloparena logout
  sloparena scan [--days 365] [--providers claude,codex] [--json]
  sloparena submit [--server ${DEFAULT_API_URL}] [--days 365] [--providers claude,codex]

Options:
  --machine <id>        Stable machine identifier override
  --server <url>        API base URL (default: ${DEFAULT_API_URL})
  --web <url>           Leaderboard URL (default: ${DEFAULT_WEB_URL})
  --days <number>       Rolling window to scan (default: 365)
  --providers <list>    Comma-separated providers: claude,codex
  --x-handle <handle>   Save an optional X handle on your profile
  --clear-x-handle      Remove the saved X handle
  --json                Print raw JSON output for scan
`);
}

function parseProviders(value?: string): ProviderId[] {
  const parts = (value ?? "claude,codex")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const valid = parts.filter((item): item is ProviderId => item === "claude" || item === "codex");
  return valid.length > 0 ? [...new Set(valid)] : ["claude", "codex"];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  const command = ["submit", "scan", "login", "whoami", "logout", "profile", "go"].includes(commandRaw ?? "")
    ? (commandRaw as ParsedArgs["command"])
    : "help";
  const args = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) {
      continue;
    }

    const key = item.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return {
    command,
    machineId: typeof args.get("machine") === "string" ? String(args.get("machine")) : undefined,
    server: typeof args.get("server") === "string" ? String(args.get("server")) : DEFAULT_API_URL,
    web: typeof args.get("web") === "string" ? String(args.get("web")) : DEFAULT_WEB_URL,
    days: Number(typeof args.get("days") === "string" ? args.get("days") : 365),
    providers: parseProviders(typeof args.get("providers") === "string" ? String(args.get("providers")) : undefined),
    json: Boolean(args.get("json")),
    xHandle: typeof args.get("x-handle") === "string" ? String(args.get("x-handle")) : undefined,
    clearXHandle: Boolean(args.get("clear-x-handle")),
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatRow(label: string, value: string): string {
  return `${label.padEnd(18)} ${value}`;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  output.write(`${frames[0]} ${message}`);
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    output.write(`\r${frames[index]} ${message}`);
  }, 90);

  try {
    const result = await task();
    clearInterval(timer);
    output.write(`\r✓ ${message}\n`);
    return result;
  } catch (error) {
    clearInterval(timer);
    output.write(`\r✗ ${message}\n`);
    throw error;
  }
}

async function runGoFlow(parsed: ParsedArgs): Promise<void> {
  let session = await loadLocalSession();
  if (!session) {
    session = await loginWithGitHub(parsed.server);
    console.log(`Logged in as ${session.profile.displayName} (@${session.profile.handle})`);
  } else {
    console.log(`Using saved GitHub login for ${session.profile.displayName} (@${session.profile.handle})`);
  }

  const currentX = session.profile.xHandle ? `@${session.profile.xHandle}` : "not set";
  console.log(`Current X handle: ${currentX}`);
  const xAnswer = await prompt('Optional X handle. Type a handle, or press Enter to keep current and continue: ');
  if (xAnswer) {
    session = await updateXHandle(xAnswer);
    console.log(`Saved X handle: @${session.profile.xHandle}`);
  }

  const action = (await prompt('Press Enter to submit your 365-day snapshot, or type "skip" to cancel: ')).toLowerCase();
  if (action === 'skip') {
    console.log('Skipped submission.');
    console.log(`Leaderboard: ${parsed.web}`);
    await openBrowser(parsed.web);
    return;
  }

  const snapshot = await withSpinner('Crunching your local usage data...', () =>
    collectSnapshot({
      machineId: parsed.machineId,
      days: parsed.days,
      providers: parsed.providers,
    }),
  );

  const response = await withSpinner('Publishing your snapshot to the leaderboard...', async () =>
    submitSnapshot(
      parsed.server || session.serverUrl,
      session.githubAccessToken,
      snapshot,
      session.profile.xHandle,
    ) as Promise<{ snapshotId: string }>,
  );

  console.log(`Submitted snapshot for ${session.profile.displayName} (@${session.profile.handle})`);
  console.log(`Leaderboard: ${parsed.web}`);
  console.log(`Snapshot ID: ${response.snapshotId}`);
  await openBrowser(parsed.web);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (parsed.command === "go") {
    await runGoFlow(parsed);
    return;
  }

  if (parsed.command === "login") {
    const session = await loginWithGitHub(parsed.server);
    console.log(`Logged in as ${session.profile.displayName} (@${session.profile.handle})`);
    console.log(`Saved local auth session to ${getAuthFilePath()}`);
    return;
  }

  if (parsed.command === "whoami") {
    const session = await loadLocalSession();
    if (!session) {
      console.log("Not logged in.");
      return;
    }
    console.log(formatRow("Display name", session.profile.displayName));
    console.log(formatRow("GitHub", `@${session.profile.handle}`));
    console.log(formatRow("GitHub URL", session.profile.profileUrl));
    console.log(formatRow("X handle", session.profile.xHandle ? `@${session.profile.xHandle}` : "not set"));
    console.log(formatRow("Provider ID", session.profile.providerUserId));
    console.log(formatRow("Server", session.serverUrl));
    console.log(formatRow("Saved at", session.savedAt));
    return;
  }

  if (parsed.command === "profile") {
    if (!parsed.xHandle && !parsed.clearXHandle) {
      throw new Error("`profile` requires --x-handle <handle> or --clear-x-handle");
    }
    const session = await updateXHandle(parsed.clearXHandle ? undefined : parsed.xHandle);
    console.log(`Saved X handle: ${session.profile.xHandle ? `@${session.profile.xHandle}` : "not set"}`);
    return;
  }

  if (parsed.command === "logout") {
    await logoutLocalSession();
    console.log("Logged out locally.");
    return;
  }

  const snapshot = await collectSnapshot({
    machineId: parsed.machineId,
    days: parsed.days,
    providers: parsed.providers,
  });

  if (parsed.command === "scan") {
    if (parsed.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    console.log(formatRow("Machine", snapshot.machineId));
    console.log(formatRow("Window", `${snapshot.windowDays} days`));
    for (const provider of snapshot.providers) {
      console.log("");
      console.log(`[${provider.provider}]`);
      console.log(formatRow("Total", formatNumber(provider.totals.total)));
      console.log(formatRow("Input", formatNumber(provider.totals.input)));
      console.log(formatRow("Output", formatNumber(provider.totals.output)));
      console.log(formatRow("Cache", formatNumber(provider.totals.cache)));
      console.log(formatRow("Top model", provider.byModel[0]?.model ?? "n/a"));
      console.log(formatRow("Activity days", String(provider.activityDays)));
    }
    return;
  }

  const session = await requireLocalSession();
  const response = await submitSnapshot(
    parsed.server || session.serverUrl,
    session.githubAccessToken,
    snapshot,
    session.profile.xHandle,
  ) as {
    ok: boolean;
    snapshotId: string;
    profile?: { displayName: string; handle: string; xHandle?: string };
  };

  console.log(`Submitted snapshot for ${session.profile.displayName} (@${session.profile.handle})`);
  if (session.profile.xHandle) {
    console.log(`X handle: @${session.profile.xHandle}`);
  }
  console.log(`Machine: ${snapshot.machineId}`);
  console.log(`Snapshot ID: ${response.snapshotId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Hint: machine defaults to ${getDefaultMachineId()}`);
  process.exitCode = 1;
});
