import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import onlinePlayersRouter from "./routes/online-players.js";
import authRouter from "./routes/auth.js";
import accountRouter from "./routes/account.js";
import boostsRouter from "./routes/boosts.js";
import registerRouter from "./routes/register.js";
import statsDeathsRouter from "./routes/stats-deaths.js";
import statsBossKillsRouter from "./routes/stats-boss-kills.js";
import statsQuestCompletionsRouter from "./routes/stats-quest-completions.js";
import statsBadNeighborhoodRouter from "./routes/stats-bad-neighborhood.js";
import statsRealRaidBossRouter from "./routes/stats-real-raid-boss.js";
import statsTouchingGrassRouter from "./routes/stats-touching-grass.js";
import statsPublicEnemyRouter from "./routes/stats-public-enemy.js";
import statsBotWranglerRouter from "./routes/stats-bot-wrangler.js";
import statsVendorTrashMagnateRouter from "./routes/stats-vendor-trash-magnate.js";
import statsGottaKillEmAllRouter from "./routes/stats-gotta-kill-em-all.js";
import statsLooseChangeLegendRouter from "./routes/stats-loose-change-legend.js";
import statsPetKillsRouter from "./routes/stats-pet-kills.js";
import statsPunchingUpRouter from "./routes/stats-punching-up.js";
import { captureRawJsonBody } from "./services/raw-json-body.js";
import rosterRouter from "./routes/roster.js";
import statusRouter from "./routes/status.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultClientOutputDir = path.resolve(__dirname, "public");

interface CreateAppOptions {
  clientOutputDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const clientOutputDir = options.clientOutputDir ?? defaultClientOutputDir;

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    response.set("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(express.json({ limit: "16kb", verify: captureRawJsonBody }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  const rejectInvalidBody: ErrorRequestHandler = (error, request, response, next) => {
    const type = typeof error === "object" && error !== null && "type" in error
      ? String((error as { type?: unknown }).type)
      : "";
    if (
      request.path.startsWith("/api/") &&
      (type === "entity.parse.failed" || type === "entity.too.large")
    ) {
      if (request.path.startsWith("/api/boosts") || request.path.startsWith("/api/account")) {
        response.set("Cache-Control", "no-store");
      }
      return response.status(400).json({ error: "Request body must be valid JSON." });
    }
    next(error);
  };
  app.use(rejectInvalidBody);

  app.use(authRouter);
  app.use(accountRouter);
  app.use(boostsRouter);
  app.use(registerRouter);
  app.use(statusRouter);
  app.use(onlinePlayersRouter);
  app.use(rosterRouter);
  app.use(statsDeathsRouter);
  app.use(statsBossKillsRouter);
  app.use(statsQuestCompletionsRouter);
  app.use(statsBadNeighborhoodRouter);
  app.use(statsRealRaidBossRouter);
  app.use(statsTouchingGrassRouter);
  app.use(statsPublicEnemyRouter);
  app.use(statsBotWranglerRouter);
  app.use(statsVendorTrashMagnateRouter);
  app.use(statsGottaKillEmAllRouter);
  app.use(statsLooseChangeLegendRouter);
  app.use(statsPetKillsRouter);
  app.use(statsPunchingUpRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(express.static(clientOutputDir, { index: false }));

  const sendClientIndex: RequestHandler = (request, response, next) => {
    if (request.path === "/settings") {
      response.set("Cache-Control", "no-store");
    }
    response.sendFile(path.join(clientOutputDir, "index.html"), (error) => {
      if (error) {
        next(error);
      }
    });
  };

  app.get(["/", "/stats", "/login", "/boosts", "/roster", "/settings"], sendClientIndex);
  app.get(/^\/stats\/[a-z0-9]+(?:-[a-z0-9]+)*$/u, sendClientIndex);

  return app;
}
