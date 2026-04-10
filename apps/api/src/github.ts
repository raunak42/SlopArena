import type { PublicProfile } from "@sloparena/shared";

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const DEFAULT_GITHUB_CLIENT_ID = "Ov23ligfZI2kUzgsi75v";
const GITHUB_TIMEOUT_MS = 20_000;

function createTimeoutSignal(timeoutMs = GITHUB_TIMEOUT_MS): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export function getGitHubClientId(): string {
  return process.env.GITHUB_CLIENT_ID?.trim() || DEFAULT_GITHUB_CLIENT_ID;
}

function getGitHubClientSecret(): string {
  const value = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!value) {
    throw new Error("Missing GITHUB_CLIENT_SECRET for browser OAuth login.");
  }
  return value;
}

export function getGitHubCallbackUrl(): string {
  const value = process.env.GITHUB_OAUTH_CALLBACK_URL?.trim();
  if (!value) {
    throw new Error("Missing GITHUB_OAUTH_CALLBACK_URL for browser OAuth login.");
  }
  return value;
}

export function buildGitHubAuthorizeUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", getGitHubClientId());
  url.searchParams.set("redirect_uri", getGitHubCallbackUrl());
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: getGitHubClientId(),
    client_secret: getGitHubClientSecret(),
    code,
    redirect_uri: getGitHubCallbackUrl(),
  });

  const { signal, cancel } = createTimeoutSignal();
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub OAuth token exchange failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as AccessTokenResponse;
    if (!payload.access_token) {
      throw new Error(payload.error_description || payload.error || "GitHub OAuth token exchange failed.");
    }

    return payload.access_token;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub OAuth token exchange timed out.");
    }
    throw error;
  } finally {
    cancel();
  }
}

export async function fetchGitHubProfile(accessToken: string, xHandle?: string): Promise<PublicProfile> {
  const { signal, cancel } = createTimeoutSignal();

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "sloparena",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
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
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub profile lookup timed out.");
    }
    throw error;
  } finally {
    cancel();
  }
}
