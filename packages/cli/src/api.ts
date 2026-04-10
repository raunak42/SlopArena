import type { SnapshotDraft, SubmitSnapshotRequest } from "@sloparena/shared";

const SUBMISSION_TIMEOUT_MS = 30_000;

function createTimeoutSignal(timeoutMs = SUBMISSION_TIMEOUT_MS): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export async function submitSnapshot(
  serverUrl: string,
  githubAccessToken: string,
  snapshot: SnapshotDraft,
  xHandle?: string,
): Promise<unknown> {
  const payload: SubmitSnapshotRequest = { githubAccessToken, xHandle, snapshot };
  const { signal, cancel } = createTimeoutSignal();

  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/submissions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Submission failed (${response.status}): ${await response.text()}`);
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Submission timed out. Please try again.");
    }
    throw error;
  } finally {
    cancel();
  }
}
