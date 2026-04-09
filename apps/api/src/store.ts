import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UsageSnapshot } from "@usageboard/shared";

interface StoreShape {
  history: UsageSnapshot[];
}

function normalizeStore(input: Partial<StoreShape> | null | undefined): StoreShape {
  return {
    history: Array.isArray(input?.history) ? input.history : [],
  };
}

export async function loadStore(filePath: string): Promise<StoreShape> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeStore(JSON.parse(raw) as Partial<StoreShape>);
  } catch {
    return normalizeStore(null);
  }
}

export async function saveStore(filePath: string, store: StoreShape): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2));
}
