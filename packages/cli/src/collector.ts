import type { ProviderId, SnapshotDraft } from "@usageboard/shared";
import { collectClaude } from "./parsers/claude.js";
import { collectCodex } from "./parsers/codex.js";
import { getDefaultMachineId, makeSnapshotBase, resolveDateWindow } from "./utils.js";

export interface CollectOptions {
  machineId?: string;
  days?: number;
  providers?: ProviderId[];
}

export async function collectSnapshot(options: CollectOptions = {}): Promise<SnapshotDraft> {
  const days = options.days ?? 365;
  const providers = options.providers ?? ["claude", "codex"];
  const { start, end } = resolveDateWindow(days);
  const providerSnapshots = await Promise.all(
    providers.map(async (provider) => {
      if (provider === "claude") {
        return collectClaude(start, end);
      }
      return collectCodex(start, end);
    }),
  );

  return {
    ...makeSnapshotBase(options.machineId ?? getDefaultMachineId(), days),
    providers: providerSnapshots.filter(Boolean),
  };
}
