import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderSnapshot, TokenTotals } from "@usageboard/shared";
import {
  addActivityDay,
  addUsage,
  createProviderState,
  ensureAbsolutePaths,
  finalizeProviderState,
  inWindow,
  listFilesRecursive,
  normalizeModelName,
  readJsonFile,
  readJsonLines,
  resolveHomePath,
  splitCsv,
  toDateKey,
} from "../utils.js";

interface ClaudeUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeLogEntry {
  timestamp?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: ClaudeUsagePayload;
  };
}

interface ClaudeStatsCache {
  dailyModelTokens?: Array<{
    date?: string;
    tokensByModel?: Record<string, number>;
  }>;
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }>;
}

interface ClaudeHistoryEntry {
  timestamp?: string | number;
}

function getClaudeBases(): string[] {
  return ensureAbsolutePaths(
    splitCsv(process.env.CLAUDE_CONFIG_DIR, [resolveHomePath('.config', 'claude'), resolveHomePath('.claude')]),
  );
}

async function getProjectFiles(): Promise<string[]> {
  const files = await Promise.all(
    getClaudeBases().map((base) => listFilesRecursive(join(base, 'projects'), '.jsonl')),
  );
  return files.flat();
}

function createTokenTotals(usage: ClaudeUsagePayload): TokenTotals {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const input = (usage.input_tokens ?? 0) + cacheRead;
  const output = (usage.output_tokens ?? 0) + cacheWrite;
  return {
    input,
    output,
    cache: cacheRead + cacheWrite,
    total: input + output,
  };
}

function distribute(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || weightSum <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (weight / weightSum) * total);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const item of order) {
    if (remainder <= 0) {
      break;
    }
    allocated[item.index] += 1;
    remainder -= 1;
  }

  return allocated;
}

function createStatsCacheTotals(totalTokens: number, usage?: ClaudeStatsCache['modelUsage'][string]): TokenTotals {
  const [inputBase, outputBase, cacheRead, cacheWrite] = distribute(totalTokens, [
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0,
    usage?.cacheReadInputTokens ?? 0,
    usage?.cacheCreationInputTokens ?? 0,
  ]);

  if (inputBase === 0 && outputBase === 0 && cacheRead === 0 && cacheWrite === 0) {
    return { input: totalTokens, output: 0, cache: 0, total: totalTokens };
  }

  return {
    input: inputBase + cacheRead,
    output: outputBase + cacheWrite,
    cache: cacheRead + cacheWrite,
    total: totalTokens,
  };
}

export async function collectClaude(start: Date, end: Date): Promise<ProviderSnapshot | null> {
  const state = createProviderState('claude');
  const files = await getProjectFiles();
  const seen = new Set<string>();
  const coveredDates = new Set<string>();

  for (const file of files) {
    state.sourceCount += 1;
    await readJsonLines(file, (line) => {
      let entry: ClaudeLogEntry;
      try {
        entry = JSON.parse(line) as ClaudeLogEntry;
      } catch {
        return;
      }

      if (!entry.timestamp || !entry.message?.usage) {
        return;
      }

      const uniqueKey = entry.message.id && entry.requestId ? `${entry.message.id}:${entry.requestId}` : undefined;
      if (uniqueKey && seen.has(uniqueKey)) {
        return;
      }
      if (uniqueKey) {
        seen.add(uniqueKey);
      }

      const timestamp = new Date(entry.timestamp);
      if (!inWindow(timestamp, start, end)) {
        return;
      }

      const totals = createTokenTotals(entry.message.usage);
      if (totals.total <= 0) {
        return;
      }

      const model = entry.message.model && entry.message.model !== '<synthetic>' ? normalizeModelName(entry.message.model) : undefined;
      const dateKey = toDateKey(timestamp);
      coveredDates.add(dateKey);
      addUsage(state, dateKey, totals, model);
    });
  }

  for (const base of getClaudeBases()) {
    const statsCachePath = join(base, 'stats-cache.json');
    const statsCache = existsSync(statsCachePath) ? await readJsonFile<ClaudeStatsCache>(statsCachePath) : null;
    if (statsCache) {
      for (const row of statsCache.dailyModelTokens ?? []) {
        if (!row.date || coveredDates.has(row.date)) {
          continue;
        }

        const timestamp = new Date(`${row.date}T00:00:00`);
        if (!inWindow(timestamp, start, end)) {
          continue;
        }

        for (const [rawModel, totalTokens] of Object.entries(row.tokensByModel ?? {})) {
          if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
            continue;
          }
          addUsage(
            state,
            row.date,
            createStatsCacheTotals(totalTokens, statsCache.modelUsage?.[rawModel]),
            normalizeModelName(rawModel),
          );
        }
      }
    }

    const historyPath = join(base, 'history.jsonl');
    if (existsSync(historyPath)) {
      state.sourceCount += 1;
      await readJsonLines(historyPath, (line) => {
        let entry: ClaudeHistoryEntry;
        try {
          entry = JSON.parse(line) as ClaudeHistoryEntry;
        } catch {
          return;
        }

        const timestamp = typeof entry.timestamp === 'number'
          ? new Date(entry.timestamp)
          : typeof entry.timestamp === 'string'
            ? new Date(entry.timestamp)
            : null;
        if (!timestamp || !inWindow(timestamp, start, end)) {
          return;
        }

        const dateKey = toDateKey(timestamp);
        if (!coveredDates.has(dateKey)) {
          addActivityDay(state, dateKey);
        }
      });
    }
  }

  return state.byDay.size > 0 || state.totals.total > 0 ? finalizeProviderState(state) : null;
}
