import type { LocalAuthSession, PublicProfile } from "@sloparena/shared";
import { openBrowser } from "./browser.js";
import { clearLocalSession, loadLocalSession, saveLocalSession } from "./utils.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

const DEFAULT_GITHUB_CLIENT_ID = "Ov23ligfZI2kUzgsi75v";

function getGitHubClientId(): string {
  return process.env.GITHUB_CLIENT_ID?.trim() || DEFAULT_GITHUB_CLIENT_ID;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const clientId = getGitHubClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    scope: "read:user",
  });
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`GitHub device code request failed (${response.status}): ${await response.text()}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

async function pollAccessToken(deviceCode: DeviceCodeResponse): Promise<string> {
  const clientId = getGitHubClientId();
  let intervalMs = Math.max(deviceCode.interval, 5) * 1000;
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);

    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`GitHub token polling failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as AccessTokenResponse;
    if (payload.access_token) {
      return payload.access_token;
    }

    if (payload.error === "authorization_pending") {
      continue;
    }

    if (payload.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }

    if (payload.error === "expired_token") {
      throw new Error("GitHub login expired before it was completed. Run `sloparena login` again.");
    }

    throw new Error(payload.error_description || payload.error || "GitHub login failed.");
  }

  throw new Error("GitHub login timed out. Run `sloparena login` again.");
}

export async function fetchGitHubProfile(accessToken: string, xHandle?: string): Promise<PublicProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "sloparena",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub profile lookup failed (${response.status}): ${await response.text()}`);
  }

  const user = (await response.json()) as GitHubUserResponse;
  return {
    provider: "github",
    providerUserId: String(user.id),
    handle: user.login,
    displayName: user.name?.trim() || user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    xHandle: xHandle?.trim().replace(/^@+/, "") || undefined,
  };
}

export async function loginWithGitHub(serverUrl: string): Promise<LocalAuthSession> {
  const deviceCode = await requestDeviceCode();
  const loginUrl = deviceCode.verification_uri_complete ?? deviceCode.verification_uri;
  const opened = await openBrowser(loginUrl);

  console.log(opened ? "Opened browser for GitHub login." : "Open this URL in your browser to continue login:");
  if (!opened) {
    console.log(loginUrl);
  }
  console.log(`Enter code if prompted: ${deviceCode.user_code}`);

  const accessToken = await pollAccessToken(deviceCode);
  const existing = await loadLocalSession();
  const profile = await fetchGitHubProfile(accessToken, existing?.profile.xHandle);
  const session: LocalAuthSession = {
    githubAccessToken: accessToken,
    serverUrl,
    profile,
    savedAt: new Date().toISOString(),
  };
  await saveLocalSession(session);
  return session;
}

export async function requireLocalSession(): Promise<LocalAuthSession> {
  const session = await loadLocalSession();
  if (!session) {
    throw new Error("No saved login session. Run `sloparena login --server <url>` first.");
  }
  return session;
}

export async function updateXHandle(xHandle?: string): Promise<LocalAuthSession> {
  const session = await requireLocalSession();
  const normalized = xHandle?.trim().replace(/^@+/, "") || undefined;
  const updated: LocalAuthSession = {
    ...session,
    profile: {
      ...session.profile,
      xHandle: normalized,
    },
    savedAt: new Date().toISOString(),
  };
  await saveLocalSession(updated);
  return updated;
}

export async function logoutLocalSession(): Promise<void> {
  await clearLocalSession();
}
