import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import type { PublicProfile, UsageSnapshot } from "@sloparena/shared";
import { buildDashboard } from "./aggregate.js";
import { initDatabase, insertSnapshot, listSnapshots, pingDatabase } from "./db.js";
import { buildGitHubAuthorizeUrl, exchangeGitHubCode, fetchGitHubProfile } from "./github.js";
import { parseSubmitRequest } from "./validation.js";

const port = Number(process.env.PORT ?? 4000);
const webUrl = process.env.SLOPARENA_WEB_URL?.trim() || "https://sloparena.up.railway.app";
const authSessions = new Map<string, {
  status: "pending" | "complete" | "error";
  accessToken?: string;
  profile?: PublicProfile;
  error?: string;
  createdAt: number;
}>();
const AUTH_TTL_MS = 10 * 60 * 1000;

function cleanupAuthSessions(): void {
  const now = Date.now();
  for (const [state, session] of authSessions.entries()) {
    if (now - session.createdAt > AUTH_TTL_MS) {
      authSessions.delete(state);
    }
  }
}

function renderAuthPage(title: string, message: string, isError = false): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0b1020; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
      .card { max-width: 520px; width: 100%; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 20px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0; line-height: 1.6; color: #cbd5e1; }
      a { color: ${isError ? "#fda4af" : "#93c5fd"}; }
      .pill { display:inline-block; margin-bottom: 14px; padding: 6px 10px; border-radius: 999px; background: ${isError ? "rgba(190,24,93,.16)" : "rgba(59,130,246,.16)"}; color: ${isError ? "#fecdd3" : "#bfdbfe"}; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="pill">SlopArena</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <p style="margin-top:16px"><a href="${webUrl}">Open leaderboard</a></p>
    </main>
  </body>
</html>`;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_request, response) => {
  try {
    cleanupAuthSessions();
    await pingDatabase();
    response.json({ ok: true, port, database: "connected" });
  } catch (error) {
    response.status(500).json({ ok: false, port, database: "error", error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/auth/github/start", (request, response) => {
  cleanupAuthSessions();
  const state = typeof request.query.state === "string" && request.query.state.trim() ? request.query.state.trim() : randomUUID();
  authSessions.set(state, { status: "pending", createdAt: Date.now() });

  try {
    response.redirect(buildGitHubAuthorizeUrl(state));
  } catch (error) {
    authSessions.set(state, { status: "error", error: error instanceof Error ? error.message : String(error), createdAt: Date.now() });
    response.status(500).send(renderAuthPage("GitHub login is not configured", "SlopArena is missing GitHub OAuth settings on the server. Add the GitHub OAuth environment variables and try again.", true));
  }
});

app.get("/api/auth/github/callback", async (request, response) => {
  cleanupAuthSessions();
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const githubError = typeof request.query.error === "string" ? request.query.error.trim() : "";

  if (!state || !authSessions.has(state)) {
    response.status(400).send(renderAuthPage("Login session not found", "This GitHub login session is missing or expired. Please go back to the terminal and run SlopArena again.", true));
    return;
  }

  if (githubError) {
    authSessions.set(state, { status: "error", error: githubError, createdAt: Date.now() });
    response.status(400).send(renderAuthPage("GitHub login cancelled", "GitHub did not complete the authorization flow. Return to the terminal and try again.", true));
    return;
  }

  if (!code) {
    authSessions.set(state, { status: "error", error: "Missing GitHub OAuth code.", createdAt: Date.now() });
    response.status(400).send(renderAuthPage("Missing login code", "GitHub did not send an authorization code back to SlopArena.", true));
    return;
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const profile = await fetchGitHubProfile(accessToken);
    authSessions.set(state, { status: "complete", accessToken, profile, createdAt: Date.now() });
    response.send(renderAuthPage("GitHub login complete", "You are signed in. Return to the terminal — SlopArena will continue automatically."));
  } catch (error) {
    authSessions.set(state, { status: "error", error: error instanceof Error ? error.message : String(error), createdAt: Date.now() });
    response.status(500).send(renderAuthPage("GitHub login failed", "SlopArena could not finish GitHub login. Return to the terminal and try again.", true));
  }
});

app.get("/api/auth/github/status", (request, response) => {
  cleanupAuthSessions();
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  if (!state) {
    response.status(400).json({ error: "Missing state" });
    return;
  }

  const session = authSessions.get(state);
  if (!session) {
    response.status(404).json({ status: "expired", error: "Login session not found or expired." });
    return;
  }

  if (session.status === "complete") {
    response.json({
      status: "complete",
      accessToken: session.accessToken,
      profile: session.profile,
    });
    return;
  }

  if (session.status === "error") {
    response.status(400).json({ status: "error", error: session.error ?? "GitHub login failed." });
    return;
  }

  response.json({ status: "pending" });
});

app.get("/api/dashboard", async (_request, response) => {
  const history = await listSnapshots();
  response.json(buildDashboard(history));
});

app.post("/api/submissions", async (request, response) => {
  const parsed = parseSubmitRequest(request.body);
  if (!parsed) {
    response.status(400).json({ error: "Invalid submission payload" });
    return;
  }

  try {
    const profile = await fetchGitHubProfile(parsed.githubAccessToken, parsed.xHandle);
    const snapshot: UsageSnapshot = {
      ...parsed.snapshot,
      userId: profile.providerUserId,
      profile,
      submittedAt: new Date().toISOString(),
    };

    await insertSnapshot(snapshot);
    const history = await listSnapshots();

    response.status(201).json({
      ok: true,
      snapshotId: snapshot.id,
      profile: snapshot.profile,
      dashboard: buildDashboard(history),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("GitHub profile lookup failed") ? 401 : 500;
    response.status(status).json({ error: message });
  }
});

async function start(): Promise<void> {
  await initDatabase();
  app.listen(port, () => {
    console.log(`sloparena-api listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
