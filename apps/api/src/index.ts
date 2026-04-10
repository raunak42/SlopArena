import "dotenv/config";
import cors from "cors";
import express from "express";
import type { UsageSnapshot } from "@sloparena/shared";
import { buildDashboard } from "./aggregate.js";
import { initDatabase, insertSnapshot, listSnapshots, pingDatabase } from "./db.js";
import { fetchGitHubProfile } from "./github.js";
import { parseSubmitRequest } from "./validation.js";

const port = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_request, response) => {
  try {
    await pingDatabase();
    response.json({ ok: true, port, database: "connected" });
  } catch (error) {
    response.status(500).json({ ok: false, port, database: "error", error: error instanceof Error ? error.message : String(error) });
  }
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
    response.status(401).json({ error: error instanceof Error ? error.message : String(error) });
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
