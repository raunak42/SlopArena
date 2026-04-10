import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  addTotals,
  emptyTotals,
  formatDateKey,
  sortModelUsage,
  type DailyUsage,
  type LocalAuthSession,
  type ModelUsage,
  type ProviderId,
  type ProviderSnapshot,
  type SnapshotDraft,
  type TokenTotals,
} from "@sloparena/shared";

export interface AggregatedProviderState {
  provider: ProviderId;
  totals: TokenTotals;
  byModel: Map<string, TokenTotals>;
  byDay: Map<string, { totals: TokenTotals; models: Map<string, TokenTotals>; displayValue: number }>;
  sourceCount: number;
}

const APP_DIR = join(homedir(), ".sloparena");
const AUTH_FILE = join(APP_DIR, "auth.json");
const LEGACY_APP_DIR = join(homedir(), ".usageboard");
const LEGACY_AUTH_FILE = join(LEGACY_APP_DIR, "auth.json");

export function createProviderState(provider: ProviderId): AggregatedProviderState {
  return {
    provider,
    totals: emptyTotals(),
    byModel: new Map(),
    byDay: new Map(),
    sourceCount: 0,
  };
}

export function normalizeModelName(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }

  return model.replace(/-\d{8}$/, "");
}

export function addUsage(
  state: AggregatedProviderState,
  dateKey: string,
  totals: TokenTotals,
  model?: string,
  displayValue = 0,
): void {
  addTotals(state.totals, totals);

  const day = state.byDay.get(dateKey) ?? {
    totals: emptyTotals(),
    models: new Map<string, TokenTotals>(),
    displayValue: 0,
  };
  addTotals(day.totals, totals);
  day.displayValue += displayValue;
  state.byDay.set(dateKey, day);

  if (!model) {
    return;
  }

  const modelTotals = state.byModel.get(model) ?? emptyTotals();
  addTotals(modelTotals, totals);
  state.byModel.set(model, modelTotals);

  const dayModelTotals = day.models.get(model) ?? emptyTotals();
  addTotals(dayModelTotals, totals);
  day.models.set(model, dayModelTotals);
}

export function addActivityDay(state: AggregatedProviderState, dateKey: string): void {
  const day = state.byDay.get(dateKey) ?? {
    totals: emptyTotals(),
    models: new Map<string, TokenTotals>(),
    displayValue: 0,
  };
  day.displayValue += 1;
  state.byDay.set(dateKey, day);
}

export function finalizeProviderState(state: AggregatedProviderState): ProviderSnapshot {
  const byModel: ModelUsage[] = sortModelUsage(
    [...state.byModel.entries()].map(([model, tokens]) => ({ model, tokens })),
  );

  const byDay: DailyUsage[] = [...state.byDay.entries()]
    .map(([date, value]) => ({
      date,
      totals: value.totals,
      models: sortModelUsage(
        [...value.models.entries()].map(([model, tokens]) => ({ model, tokens })),
      ),
      displayValue: value.displayValue > 0 ? value.displayValue : undefined,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    provider: state.provider,
    totals: state.totals,
    byModel,
    byDay,
    sourceCount: state.sourceCount,
    activityDays: byDay.filter((day) => day.totals.total > 0 || day.displayValue).length,
  };
}

export async function listFilesRecursive(root: string, extension: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath, extension);
      }
      return fullPath.endsWith(extension) ? [fullPath] : [];
    }),
  );

  return files.flat();
}

export async function readJsonLines(filePath: string, onLine: (line: string) => Promise<void> | void): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of reader) {
    if (line.trim()) {
      await onLine(line);
    }
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function resolveDateWindow(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(days - 1, 0));
  return { start, end };
}

export function inWindow(timestamp: Date, start: Date, end: Date): boolean {
  return timestamp.getTime() >= start.getTime() && timestamp.getTime() <= end.getTime();
}

export function toDateKey(timestamp: Date): string {
  return formatDateKey(timestamp);
}

export function getDefaultMachineId(): string {
  return createHash("sha256")
    .update(`${hostname()}::${homedir()}::sloparena`)
    .digest("hex")
    .slice(0, 16);
}

export function splitCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim() === "") {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function makeSnapshotBase(machineId: string, days: number): Pick<SnapshotDraft, "id" | "machineId" | "capturedAt" | "submittedAt" | "windowDays" | "cliVersion"> {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    machineId,
    capturedAt: now,
    submittedAt: now,
    windowDays: days,
    cliVersion: "0.1.0",
  };
}

export function resolveHomePath(...segments: string[]): string {
  return resolve(homedir(), ...segments);
}

export function ensureAbsolutePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

export function parentDir(path: string): string {
  return dirname(path);
}

export async function saveLocalSession(session: LocalAuthSession): Promise<void> {
  await mkdir(APP_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(session, null, 2));
}

export async function loadLocalSession(): Promise<LocalAuthSession | null> {
  const current = await readJsonFile<LocalAuthSession>(AUTH_FILE);
  if (current) {
    return current;
  }

  const legacy = await readJsonFile<LocalAuthSession>(LEGACY_AUTH_FILE);
  if (legacy) {
    await saveLocalSession(legacy);
    return legacy;
  }

  return null;
}

export async function clearLocalSession(): Promise<void> {
  if (existsSync(AUTH_FILE)) {
    await rm(AUTH_FILE);
  }
}

export function getAuthFilePath(): string {
  return AUTH_FILE;
}
