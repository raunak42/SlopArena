import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderSnapshot } from "@usageboard/shared";
import {
  addUsage,
  createProviderState,
  finalizeProviderState,
  inWindow,
  listFilesRecursive,
  normalizeModelName,
  readJsonLines,
  resolveHomePath,
  toDateKey,
} from "../utils.js";

interface CodexUsagePayload {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexEvent {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    model_name?: string;
    metadata?: { model?: string };
    info?: {
      model?: string;
      model_name?: string;
      metadata?: { model?: string };
      last_token_usage?: CodexUsagePayload;
      total_token_usage?: CodexUsagePayload;
    };
  };
}

interface NormalizedUsage {
  input: number;
  cache: number;
  output: number;
  reasoning: number;
  total: number;
}

function getCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || resolveHomePath('.codex');
}

async function getSessionFiles(): Promise<string[]> {
  return listFilesRecursive(join(getCodexHome(), 'sessions'), '.jsonl');
}

function extractModel(event: CodexEvent): string | undefined {
  const payload = event.payload;
  return payload?.model
    ?? payload?.model_name
    ?? payload?.info?.model
    ?? payload?.info?.model_name
    ?? payload?.info?.metadata?.model
    ?? payload?.metadata?.model;
}

function normalizeUsage(value?: CodexUsagePayload): NormalizedUsage | null {
  if (!value) {
    return null;
  }

  const input = value.input_tokens ?? 0;
  const cache = value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  const output = value.output_tokens ?? 0;
  const reasoning = value.reasoning_output_tokens ?? 0;
  const total = value.total_tokens ?? 0;

  return {
    input,
    cache,
    output,
    reasoning,
    total: total > 0 ? total : input + output,
  };
}

function subtractTotals(current: NormalizedUsage, previous: NormalizedUsage | null): NormalizedUsage {
  return {
    input: Math.max(current.input - (previous?.input ?? 0), 0),
    cache: Math.max(current.cache - (previous?.cache ?? 0), 0),
    output: Math.max(current.output - (previous?.output ?? 0), 0),
    reasoning: Math.max(current.reasoning - (previous?.reasoning ?? 0), 0),
    total: Math.max(current.total - (previous?.total ?? 0), 0),
  };
}

function didRollback(current: NormalizedUsage, previous: NormalizedUsage | null): boolean {
  if (!previous) {
    return false;
  }

  return current.input < previous.input || current.cache < previous.cache || current.output < previous.output || current.reasoning < previous.reasoning || current.total < previous.total;
}

function addUsageTotals(base: NormalizedUsage | null, delta: NormalizedUsage): NormalizedUsage {
  return {
    input: (base?.input ?? 0) + delta.input,
    cache: (base?.cache ?? 0) + delta.cache,
    output: (base?.output ?? 0) + delta.output,
    reasoning: (base?.reasoning ?? 0) + delta.reasoning,
    total: (base?.total ?? 0) + delta.total,
  };
}

export async function collectCodex(start: Date, end: Date): Promise<ProviderSnapshot | null> {
  const state = createProviderState('codex');
  const files = await getSessionFiles();

  for (const file of files) {
    state.sourceCount += 1;
    let currentModel: string | undefined;
    let previousTotals: NormalizedUsage | null = null;

    await readJsonLines(file, (line) => {
      let entry: CodexEvent;
      try {
        entry = JSON.parse(line) as CodexEvent;
      } catch {
        return;
      }

      const model = extractModel(entry);
      if (entry.type === 'turn_context') {
        currentModel = model ?? currentModel;
        return;
      }

      if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count' || !entry.timestamp) {
        return;
      }

      const timestamp = new Date(entry.timestamp);
      if (!inWindow(timestamp, start, end)) {
        return;
      }

      const lastUsage = normalizeUsage(entry.payload.info?.last_token_usage);
      const totalUsage = normalizeUsage(entry.payload.info?.total_token_usage);
      let usage: NormalizedUsage | null = null;

      if (totalUsage) {
        usage = didRollback(totalUsage, previousTotals) ? (lastUsage ?? totalUsage) : subtractTotals(totalUsage, previousTotals);
        previousTotals = totalUsage;
      } else if (lastUsage) {
        usage = lastUsage;
        previousTotals = addUsageTotals(previousTotals, lastUsage);
      }

      if (!usage || usage.total <= 0) {
        return;
      }

      addUsage(
        state,
        toDateKey(timestamp),
        {
          input: usage.input,
          output: usage.output,
          cache: usage.cache,
          total: usage.total,
        },
        normalizeModelName(model ?? currentModel),
      );
    });
  }

  return state.byDay.size > 0 || state.totals.total > 0 ? finalizeProviderState(state) : null;
}

export function isCodexAvailable(): boolean {
  return existsSync(join(getCodexHome(), 'sessions'));
}
