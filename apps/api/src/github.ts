import type { PublicProfile } from "@usageboard/shared";

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

export async function fetchGitHubProfile(accessToken: string, xHandle?: string): Promise<PublicProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "usageboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub profile lookup failed (${response.status}): ${await response.text()}`);
  }

  const user = (await response.json()) as GitHubUserResponse;
  const normalizedXHandle = xHandle?.trim().replace(/^@+/, "") || undefined;

  return {
    provider: "github",
    providerUserId: String(user.id),
    handle: user.login,
    displayName: user.name?.trim() || user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    xHandle: normalizedXHandle,
  };
}
