import type { SnapshotDraft, SubmitSnapshotRequest } from "@usageboard/shared";

export async function submitSnapshot(
  serverUrl: string,
  githubAccessToken: string,
  snapshot: SnapshotDraft,
  xHandle?: string,
): Promise<unknown> {
  const payload: SubmitSnapshotRequest = { githubAccessToken, xHandle, snapshot };
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/submissions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Submission failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}
