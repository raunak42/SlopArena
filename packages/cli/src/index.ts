#!/usr/bin/env node
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ProviderId } from '@sloparena/shared';
import { submitSnapshot } from './api.js';
import { loginWithGitHub, logoutLocalSession, requireLocalSession, updateXHandle } from './auth.js';
import { openBrowser } from './browser.js';
import { collectSnapshot } from './collector.js';
import {
  formatHandle,
  hero,
  info,
  link,
  muted,
  printErrorCard,
  printHelpCard,
  printProfileCard,
  printSnapshotSummary,
  printSuccessCard,
  printWarningCard,
  promptText,
  success,
} from './ui.js';
import { getAuthFilePath, getDefaultMachineId, loadLocalSession } from './utils.js';

const DEFAULT_API_URL = process.env.SLOPARENA_API_URL?.trim() || 'https://usageboard-api-production.up.railway.app';
const DEFAULT_WEB_URL = process.env.SLOPARENA_WEB_URL?.trim() || 'https://sloparena.up.railway.app';

interface ParsedArgs {
  command: 'scan' | 'submit' | 'login' | 'whoami' | 'logout' | 'profile' | 'go' | 'help';
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
  hero();
  printHelpCard(DEFAULT_API_URL, DEFAULT_WEB_URL);
}

function parseProviders(value?: string): ProviderId[] {
  const parts = (value ?? 'claude,codex')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const valid = parts.filter((item): item is ProviderId => item === 'claude' || item === 'codex');
  return valid.length > 0 ? [...new Set(valid)] : ['claude', 'codex'];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  const command = ['submit', 'scan', 'login', 'whoami', 'logout', 'profile', 'go'].includes(commandRaw ?? '')
    ? (commandRaw as ParsedArgs['command'])
    : 'help';
  const args = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return {
    command,
    machineId: typeof args.get('machine') === 'string' ? String(args.get('machine')) : undefined,
    server: typeof args.get('server') === 'string' ? String(args.get('server')) : DEFAULT_API_URL,
    web: typeof args.get('web') === 'string' ? String(args.get('web')) : DEFAULT_WEB_URL,
    days: Number(typeof args.get('days') === 'string' ? args.get('days') : 365),
    providers: parseProviders(typeof args.get('providers') === 'string' ? String(args.get('providers')) : undefined),
    json: Boolean(args.get('json')),
    xHandle: typeof args.get('x-handle') === 'string' ? String(args.get('x-handle')) : undefined,
    clearXHandle: Boolean(args.get('clear-x-handle')),
  };
}

async function prompt(label: string, hint?: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(promptText(label, hint))).trim();
  } finally {
    rl.close();
  }
}

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
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
  hero();
  info('Launching the guided arena run.');

  let session = await loadLocalSession();
  if (!session) {
    info('No saved GitHub session found. Starting login.');
    session = await loginWithGitHub(parsed.server);
    success(`Logged in as ${session.profile.displayName} (${formatHandle(session.profile.handle)})`);
  } else {
    success(`Using saved GitHub login for ${session.profile.displayName} (${formatHandle(session.profile.handle)})`);
  }

  printProfileCard({
    profile: session.profile,
    serverUrl: session.serverUrl,
    savedAt: session.savedAt,
  });

  const xAnswer = await prompt('Optional X handle', `press Enter to keep ${formatHandle(session.profile.xHandle)}`);
  if (xAnswer) {
    session = await updateXHandle(xAnswer);
    success(`Saved X handle ${formatHandle(session.profile.xHandle)}`);
  }

  const snapshot = await withSpinner('Crunching your local usage data...', () =>
    collectSnapshot({
      machineId: parsed.machineId,
      days: parsed.days,
      providers: parsed.providers,
    }),
  );

  printSnapshotSummary(snapshot);

  const response = await withSpinner('Publishing your snapshot to the leaderboard...', async () =>
    submitSnapshot(
      parsed.server || session.serverUrl,
      session.githubAccessToken,
      snapshot,
      session.profile.xHandle,
    ) as Promise<{ snapshotId: string }>,
  );

  printSuccessCard('published', [
    `${session.profile.displayName} is now on the board.`,
    `Snapshot ID → ${response.snapshotId}`,
    `Leaderboard → ${link(parsed.web)}`,
  ]);
  info('Opening the leaderboard in your browser...');
  await openBrowser(parsed.web);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  if (!(parsed.command === 'scan' && parsed.json) && parsed.command !== 'go') {
    hero();
  }

  if (parsed.command === 'go') {
    await runGoFlow(parsed);
    return;
  }

  if (parsed.command === 'login') {
    info('Starting GitHub login.');
    const session = await loginWithGitHub(parsed.server);
    printSuccessCard('login complete', [
      `${session.profile.displayName} ${formatHandle(session.profile.handle)}`,
      `Auth saved to ${getAuthFilePath()}`,
    ]);
    printProfileCard({
      profile: session.profile,
      serverUrl: session.serverUrl,
      savedAt: session.savedAt,
    });
    return;
  }

  if (parsed.command === 'whoami') {
    const session = await loadLocalSession();
    if (!session) {
      printWarningCard('not logged in', ['No local GitHub session found.', 'Run sloparena login to connect your account.']);
      return;
    }
    printProfileCard({
      profile: session.profile,
      serverUrl: session.serverUrl,
      savedAt: session.savedAt,
    });
    return;
  }

  if (parsed.command === 'profile') {
    if (!parsed.xHandle && !parsed.clearXHandle) {
      throw new Error('`profile` requires --x-handle <handle> or --clear-x-handle');
    }
    const session = await updateXHandle(parsed.clearXHandle ? undefined : parsed.xHandle);
    printSuccessCard('profile updated', [`X handle → ${formatHandle(session.profile.xHandle)}`]);
    printProfileCard({
      profile: session.profile,
      serverUrl: session.serverUrl,
      savedAt: session.savedAt,
    });
    return;
  }

  if (parsed.command === 'logout') {
    await logoutLocalSession();
    printSuccessCard('logged out', ['Removed the local SlopArena auth session from this machine.']);
    return;
  }

  const snapshot = await withSpinner('Scanning local logs...', () =>
    collectSnapshot({
      machineId: parsed.machineId,
      days: parsed.days,
      providers: parsed.providers,
    }),
  );

  if (parsed.command === 'scan') {
    if (parsed.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    printSnapshotSummary(snapshot);
    return;
  }

  const session = await requireLocalSession();
  printSnapshotSummary(snapshot);

  const response = (await withSpinner('Submitting snapshot...', () =>
    submitSnapshot(parsed.server || session.serverUrl, session.githubAccessToken, snapshot, session.profile.xHandle) as Promise<{
      ok: boolean;
      snapshotId: string;
      profile?: { displayName: string; handle: string; xHandle?: string };
    }>,
  )) as {
    ok: boolean;
    snapshotId: string;
    profile?: { displayName: string; handle: string; xHandle?: string };
  };

  printSuccessCard('submitted', [
    `${session.profile.displayName} ${formatHandle(session.profile.handle)}`,
    `Snapshot ID → ${response.snapshotId}`,
    `Leaderboard → ${link(parsed.web)}`,
  ]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  printErrorCard('command failed', [message, `Hint: machine defaults to ${getDefaultMachineId()}`]);
  muted('Nothing was pushed. Fix the issue and try again.');
  process.exitCode = 1;
});
