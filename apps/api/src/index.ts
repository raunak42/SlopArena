import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../..", ".env")]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

import cors from "cors";
import express from "express";
import type { UsageSnapshot } from "@sloparena/shared";
import { buildDashboard } from "./aggregate.js";
import {
  cleanupAuthSessions as cleanupStoredAuthSessions,
  deleteAuthSession,
  getAuthSession,
  initDatabase,
  insertSnapshot,
  listSnapshots,
  pingDatabase,
  upsertAuthSession,
} from "./db.js";
import { buildGitHubAuthorizeUrl, exchangeGitHubCode, fetchGitHubProfile } from "./github.js";
import { applySecurityHeaders, createCorsOptions, createRateLimiter, isValidAuthState } from "./security.js";
import { parseSubmitRequest } from "./validation.js";

const port = Number(process.env.PORT ?? 4000);
const webUrl = process.env.SLOPARENA_WEB_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://sloparena.vercel.app");
const AUTH_TTL_MS = 10 * 60 * 1000;
let readyPromise: Promise<void> | null = null;

const authStartLimiter = createRateLimiter({
  keyPrefix: "auth-start",
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many GitHub login attempts. Please wait a few minutes and try again.",
});
const authStatusLimiter = createRateLimiter({
  keyPrefix: "auth-status",
  windowMs: 60 * 1000,
  max: 240,
  message: "Too many login status checks. Please retry the login flow.",
});
const dashboardLimiter = createRateLimiter({
  keyPrefix: "dashboard",
  windowMs: 60 * 1000,
  max: 180,
  message: "Dashboard rate limit exceeded. Please try again shortly.",
});
const submissionLimiter = createRateLimiter({
  keyPrefix: "submission",
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Submission rate limit exceeded. Please wait before sending more snapshots.",
});

async function cleanupAuthSessions(): Promise<void> {
  await cleanupStoredAuthSessions(new Date(Date.now() - AUTH_TTL_MS));
}

export async function ensureReady(): Promise<void> {
  readyPromise ??= initDatabase();
  await readyPromise;
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

function renderBrowserLoginCompletePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub login complete</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
        background: #ffffff;
        color: #111111;
        font-family: Inter, system-ui, sans-serif;
      }
      main {
        width: 100%;
        max-width: 560px;
        text-align: center;
      }
      .logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 86px;
        height: 86px;
        margin-bottom: 22px;
      }
      .logo svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      h1 {
        margin: 0;
        font-size: clamp(32px, 5vw, 48px);
        line-height: 0.95;
        letter-spacing: -0.06em;
        font-weight: 650;
      }
      p {
        margin: 18px 0 0;
        font-size: 18px;
        line-height: 1.55;
        color: #4b5563;
      }
      strong { color: #111111; }
    </style>
  </head>
  <body>
    <main>
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
          <path fill="#CCD6DC" d="M35.858 17.376L.079 17.053v11.821c.011 1.084 1.009 2.12 2.52 3.028l2.396 1.133c.732.278 1.531.534 2.393.766l3.585.762c.791.127 1.615.232 2.46.32l9.328.088a43.678 43.678 0 0 0 2.524-.285l3.57-.707a24.447 24.447 0 0 0 2.378-.73l2.374-1.098c1.507-.893 2.262-1.923 2.251-3.013V17.376z"/>
          <path fill="#66757F" d="M22.885 30.848c-.043-4.36-2.19-5.47-4.825-5.493c-2.634-.024-4.759 1.047-4.716 5.407c.016 1.606.046 2.96.089 4.12c1.504.156 3.079.254 4.712.269c1.6.014 3.141-.054 4.616-.18c.097-1.003.142-2.341.124-4.123zM10.917 28.89l.001.107l.003.364l.003.271l.001.065c.001.052 0 .044 0 0l-.001-.065l-.003-.271l-.003-.364l-.001-.107l-.001-.122c-.022-2.18-3.61-3.303-3.589-1.122v.037l.002.204l.002.158l.005.47l.001.067l.051 5.218c1.106.297 2.302.556 3.585.762l-.056-5.753v.081zm17.878-.992l.005.506v.027l.003.27c.001.118.001.15 0 0l-.003-.27v-.027l-.005-.506l-.001-.058c-.022-2.18-3.589-1.123-3.567 1.057v.036l.057 5.753a34.49 34.49 0 0 0 3.57-.707l-.06-6.1l.001.019zM4.931 26.534c-.022-2.18-2.417-3.292-2.396-1.112v.041l.063 6.439c.676.406 1.483.785 2.396 1.133l-.052-5.321c.003.208.006.582-.011-1.18zm26.237.237l.012 1.137v-.047v.047l.053 5.34c.906-.334 1.705-.701 2.374-1.098l-.064-6.448c-.021-2.18-2.396-1.111-2.375 1.069zM2.972 5.225a.5.5 0 0 0-.5.5v12.37a.5.5 0 0 0 1 0V5.725c0-.277-.223-.5-.5-.5z"/>
          <path fill="#DD2F45" d="M3.207 5.936c1.478.269 3.682 1.102 4.246 1.424c.564.322.215.484-.322.725c-.538.242-3.441 1.021-3.87 1.102c-.431.082-.054-3.251-.054-3.251z"/>
          <path fill="#66757F" d="M11.969 2.976a.5.5 0 0 0-.5.5v12.37a.5.5 0 0 0 1 0V3.476a.5.5 0 0 0-.5-.5z"/>
          <path fill="#226798" d="M12.203 3.687c1.478.269 3.682 1.102 4.247 1.425c.564.322.215.484-.322.725c-.538.242-3.44 1.021-3.87 1.102c-.432.081-.055-3.252-.055-3.252z"/>
          <path fill="#66757F" d="M21.339 2.976a.5.5 0 0 0-.5.5v12.37a.5.5 0 0 0 1 0V3.476a.5.5 0 0 0-.5-.5z"/>
          <path fill="#DD2F45" d="M21.574 3.687c1.478.269 3.681 1.102 4.246 1.425c.564.322.215.484-.322.725c-.537.242-3.44 1.021-3.871 1.102c-.431.081-.053-3.252-.053-3.252z"/>
          <path fill="#66757F" d="M30.335 5.225a.5.5 0 0 0-.5.5v12.37a.5.5 0 0 0 1 0V5.725a.5.5 0 0 0-.5-.5z"/>
          <path fill="#226798" d="M30.57 5.936c1.478.269 3.681 1.102 4.246 1.425c.564.322.215.484-.322.725c-.537.242-3.44 1.021-3.871 1.102c-.43.081-.053-3.252-.053-3.252z"/>
          <path fill="#E9EFF3" d="M35.858 17.444c.033 3.312-7.949 5.924-17.829 5.835C8.148 23.19.112 20.431.08 17.121c-.033-3.312 7.95-5.924 17.83-5.835c9.879.09 17.915 2.847 17.948 6.158z"/>
          <path fill="#7450A0" d="M33.257 18.209c.029 2.995-6.788 5.361-15.226 5.286c-8.44-.077-15.305-2.567-15.334-5.562c-.029-2.994 6.787-5.36 15.227-5.284c8.437.077 15.304 2.566 15.333 5.56z"/>
          <path fill="#E9EFF3" d="M26.766 19.378l5.83-3.939l-1.8-1.106s-3.63 3.394-4.822 4.548c-.876-.455-2.073-.837-3.486-1.104l2.439-5.303l-2.463-.294l-1.094 5.419a26.979 26.979 0 0 0-3.401-.244a27.665 27.665 0 0 0-2.671.106l-1.183-5.357l-2.457.251l2.491 5.235c-1.64.226-3.037.604-4.036 1.085c-1.271-1.227-4.847-4.573-4.847-4.573l-1.778 1.074l5.814 3.98c-.541.397-.847.84-.843 1.311c.018 1.766 4.303 3.237 9.573 3.285c5.268.048 9.527-1.346 9.51-3.113c-.004-.445-.281-.872-.776-1.261z"/>
          <path fill="#5C903F" d="M26.427 20.862c.013 1.321-3.732 2.357-8.363 2.315c-4.631-.042-8.396-1.146-8.409-2.467c-.013-1.32 3.731-2.356 8.362-2.314c4.63.041 8.396 1.146 8.41 2.466z"/>
        </svg>
      </div>
      <h1>You are logged into SlopArena with GitHub.</h1>
      <p>Please go back to the terminal to continue.</p>
    </main>
  </body>
</html>`;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors(createCorsOptions(webUrl)));
app.use(applySecurityHeaders);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_request, response) => {
  try {
    await ensureReady();
    await cleanupAuthSessions();
    await pingDatabase();
    response.json({ ok: true, port, database: "connected" });
  } catch (error) {
    console.error("health check failed", error);
    response.status(500).json({ ok: false, port, database: "error" });
  }
});

app.get("/api/auth/github/start", authStartLimiter, async (request, response) => {
  try {
    await ensureReady();
    await cleanupAuthSessions();
    const state = typeof request.query.state === "string" && request.query.state.trim() ? request.query.state.trim() : randomUUID();
    if (!isValidAuthState(state)) {
      response.status(400).json({ error: "Invalid auth state" });
      return;
    }

    await upsertAuthSession({ state, status: "pending" });
    response.redirect(buildGitHubAuthorizeUrl(state));
  } catch (error) {
    const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
    if (state && isValidAuthState(state)) {
      await upsertAuthSession({ state, status: "error", error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    }
    response.status(500).send(renderAuthPage("GitHub login is not configured", "SlopArena is missing GitHub OAuth settings on the server. Add the GitHub OAuth environment variables and try again.", true));
  }
});

app.get("/api/auth/github/callback", async (request, response) => {
  await ensureReady();
  await cleanupAuthSessions();
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const githubError = typeof request.query.error === "string" ? request.query.error.trim() : "";
  const session = state && isValidAuthState(state) ? await getAuthSession(state) : null;

  if (!state || !isValidAuthState(state) || !session) {
    response.status(400).send(renderAuthPage("Login session not found", "This GitHub login session is missing or expired. Please go back to the terminal and run SlopArena again.", true));
    return;
  }

  if (githubError) {
    await upsertAuthSession({ state, status: "error", error: githubError });
    response.status(400).send(renderAuthPage("GitHub login cancelled", "GitHub did not complete the authorization flow. Return to the terminal and try again.", true));
    return;
  }

  if (!code) {
    await upsertAuthSession({ state, status: "error", error: "Missing GitHub OAuth code." });
    response.status(400).send(renderAuthPage("Missing login code", "GitHub did not send an authorization code back to SlopArena.", true));
    return;
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const profile = await fetchGitHubProfile(accessToken);
    await upsertAuthSession({ state, status: "complete", accessToken, profile });
    response.send(renderBrowserLoginCompletePage());
  } catch (error) {
    console.error("GitHub callback failed", error);
    await upsertAuthSession({ state, status: "error", error: error instanceof Error ? error.message : String(error) });
    response.status(500).send(renderAuthPage("GitHub login failed", "SlopArena could not finish GitHub login. Return to the terminal and try again.", true));
  }
});

app.get("/api/auth/github/status", authStatusLimiter, async (request, response) => {
  await ensureReady();
  await cleanupAuthSessions();
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  if (!state || !isValidAuthState(state)) {
    response.status(400).json({ error: "Missing state" });
    return;
  }

  const session = await getAuthSession(state);
  if (!session) {
    response.status(404).json({ status: "expired", error: "Login session not found or expired." });
    return;
  }

  if (session.status === "complete") {
    const payload = {
      status: "complete" as const,
      accessToken: session.accessToken,
      profile: session.profile,
    };
    await deleteAuthSession(state);
    response.json(payload);
    return;
  }

  if (session.status === "error") {
    response.status(400).json({ status: "error", error: session.error ?? "GitHub login failed." });
    return;
  }

  response.json({ status: "pending" });
});

app.get("/api/dashboard", dashboardLimiter, async (_request, response) => {
  try {
    await ensureReady();
    const history = await listSnapshots();
    response.json(buildDashboard(history));
  } catch (error) {
    console.error("dashboard request failed", error);
    response.status(500).json({ error: "Failed to build dashboard." });
  }
});

app.post("/api/submissions", submissionLimiter, async (request, response) => {
  const parsed = parseSubmitRequest(request.body);
  if (!parsed) {
    response.status(400).json({ error: "Invalid submission payload" });
    return;
  }

  try {
    await ensureReady();
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
    if (message.includes("GitHub profile lookup failed")) {
      response.status(401).json({ error: "GitHub login is invalid or expired. Please log in again." });
      return;
    }

    console.error("submission failed", error);
    response.status(500).json({ error: "Failed to store snapshot." });
  }
});

async function start(): Promise<void> {
  await ensureReady();
  app.listen(port, () => {
    console.log(`sloparena-api listening on http://localhost:${port}`);
  });
}

if (!process.env.VERCEL) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export default app;
