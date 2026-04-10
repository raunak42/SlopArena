import { addTotals, emptyTotals, type LocalAuthSession, type ProviderSnapshot, type SnapshotDraft } from '@sloparena/shared';

const hasColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const termWidth = Math.max(60, Math.min(96, process.stdout.columns || 80));
const contentWidth = Math.max(40, termWidth - 4);

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  blue: '\u001b[34m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  gray: '\u001b[90m',
  underline: '\u001b[4m',
};

function paint(value: string, ...codes: string[]): string {
  if (!hasColor || codes.length === 0) return value;
  return `${codes.join('')}${value}${ansi.reset}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function padRight(value: string, width: number): string {
  const remainder = Math.max(0, width - visibleLength(value));
  return `${value}${' '.repeat(remainder)}`;
}

function wrapText(value: string, width: number): string[] {
  if (!value.trim()) return [''];

  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (visibleLength(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (visibleLength(next) <= width) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function box(title: string, lines: string[], tone: 'primary' | 'success' | 'danger' | 'warning' = 'primary'): string {
  const titleText = title ? ` ${title} ` : '';
  const lineWidth = Math.max(
    contentWidth,
    ...lines.flatMap((line) => wrapText(line, contentWidth)).map((line) => visibleLength(line)),
    visibleLength(titleText),
  );
  const horizontal = '─'.repeat(Math.max(0, lineWidth - visibleLength(titleText)));
  const top = titleText
    ? `┌─${titleText}${horizontal}─┐`
    : `┌${'─'.repeat(lineWidth + 2)}┐`;
  const middle = lines
    .flatMap((line) => wrapText(line, lineWidth))
    .map((line) => `│ ${padRight(line, lineWidth)} │`)
    .join('\n');
  const bottom = `└${'─'.repeat(lineWidth + 2)}┘`;

  const toneColor =
    tone === 'success'
      ? ansi.green
      : tone === 'danger'
        ? ansi.red
        : tone === 'warning'
          ? ansi.yellow
          : ansi.cyan;

  return [paint(top, toneColor), middle, paint(bottom, toneColor)].join('\n');
}

function line(prefix: string, label: string, value: string): string {
  const left = `${prefix} ${paint(label.padEnd(12), ansi.dim)}`;
  return `${left} ${value}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0));
}

function providerGlyph(provider: ProviderSnapshot['provider']): string {
  return provider === 'claude' ? '◉' : '◎';
}

export function formatHandle(handle?: string): string {
  const normalized = (handle ?? '').trim().replace(/^@+/, '');
  return normalized ? `@${normalized}` : 'not set';
}

export function link(value: string): string {
  return hasColor ? paint(value, ansi.underline) : value;
}

export function hero(): void {
  const heading = `${paint('SLOPARENA', ansi.bold, ansi.yellow)} ${paint('terminal leaderboard', ansi.dim)}`;
  const sub = 'Publish Claude Code + Codex receipts straight from the command line.';
  console.log(box('arena', [heading, sub], 'primary'));
}

export function section(title: string): void {
  const label = paint(title.toUpperCase(), ansi.bold, ansi.magenta);
  const rule = paint('─'.repeat(Math.max(8, contentWidth - visibleLength(title) - 1)), ansi.gray);
  console.log(`${label} ${rule}`);
}

export function info(message: string): void {
  console.log(`${paint('›', ansi.cyan, ansi.bold)} ${message}`);
}

export function success(message: string): void {
  console.log(`${paint('✓', ansi.green, ansi.bold)} ${message}`);
}

export function warning(message: string): void {
  console.log(`${paint('!', ansi.yellow, ansi.bold)} ${message}`);
}

export function error(message: string): void {
  console.error(`${paint('✗', ansi.red, ansi.bold)} ${message}`);
}

export function muted(message: string): void {
  console.log(paint(message, ansi.dim));
}

export function promptText(label: string, hint?: string): string {
  const prefix = paint('›', ansi.cyan, ansi.bold);
  const message = hint ? `${label} ${paint(`(${hint})`, ansi.dim)}` : label;
  return `${prefix} ${message} `;
}

export function printProfileCard(session: Pick<LocalAuthSession, 'profile' | 'serverUrl' | 'savedAt'>): void {
  const { profile } = session;
  console.log(
    box(
      'operator',
      [
        line('◦', 'display', paint(profile.displayName, ansi.bold)),
        line('◦', 'github', `${formatHandle(profile.handle)}  ${paint(profile.profileUrl, ansi.dim)}`),
        line('◦', 'x', formatHandle(profile.xHandle)),
        line('◦', 'saved', session.savedAt),
      ],
      'primary',
    ),
  );
}

export function printSnapshotSummary(snapshot: SnapshotDraft): void {
  const totals = emptyTotals();
  for (const provider of snapshot.providers) {
    addTotals(totals, provider.totals);
  }

  const lines = [
    line('◦', 'machine', paint(snapshot.machineId, ansi.bold)),
    line('◦', 'window', `${snapshot.windowDays} days`),
    line('◦', 'providers', snapshot.providers.length ? snapshot.providers.map((item) => item.provider).join(', ') : 'none'),
    line('◦', 'total', `${formatCompact(totals.total)} tokens ${paint(`(${formatNumber(totals.total)})`, ansi.dim)}`),
    '',
    ...snapshot.providers.flatMap((provider) => {
      const providerLabel = `${providerGlyph(provider.provider)} ${paint(provider.provider, ansi.bold)}`;
      const topModel = provider.byModel[0]?.model ?? 'n/a';
      return [
        `${providerLabel}  ${formatCompact(provider.totals.total)} total`,
        `${paint('   top model', ansi.dim)} ${topModel}  ${paint('•', ansi.dim)}  ${provider.activityDays} active days`,
      ];
    }),
  ];

  console.log(box('snapshot', lines, 'primary'));
}

export function printSuccessCard(title: string, lines: string[]): void {
  console.log(box(title, lines, 'success'));
}

export function printWarningCard(title: string, lines: string[]): void {
  console.log(box(title, lines, 'warning'));
}

export function printErrorCard(title: string, lines: string[]): void {
  console.error(box(title, lines, 'danger'));
}

export function printHelpCard(apiUrl: string, webUrl: string): void {
  console.log(
    box('commands', [
      paint('sloparena go', ansi.bold) + `       guided login + submit + open leaderboard`,
      paint('sloparena login', ansi.bold) + `    save GitHub login locally`,
      paint('sloparena whoami', ansi.bold) + `   inspect current local profile`,
      paint('sloparena profile', ansi.bold) + `  save or clear optional X handle`,
      paint('sloparena scan', ansi.bold) + `     preview local usage without submitting`,
      paint('sloparena submit', ansi.bold) + `   submit current snapshot directly`,
      '',
      `${paint('--server', ansi.bold)} ${apiUrl}`,
      `${paint('--web', ansi.bold)}    ${webUrl}`,
      `${paint('--days', ansi.bold)}   365 by default`,
      `${paint('--providers', ansi.bold)} claude,codex`,
    ]),
  );
}
