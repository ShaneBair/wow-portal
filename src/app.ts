import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import onlinePlayersRouter from "./routes/online-players.js";
import authRouter from "./routes/auth.js";
import boostsRouter from "./routes/boosts.js";
import registerRouter from "./routes/register.js";
import statsDeathsRouter from "./routes/stats-deaths.js";
import statsBossKillsRouter from "./routes/stats-boss-kills.js";
import statsQuestCompletionsRouter from "./routes/stats-quest-completions.js";
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

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  const rejectInvalidBody: ErrorRequestHandler = (error, request, response, next) => {
    const type = typeof error === "object" && error !== null && "type" in error
      ? String((error as { type?: unknown }).type)
      : "";
    if (
      request.path.startsWith("/api/") &&
      (type === "entity.parse.failed" || type === "entity.too.large")
    ) {
      if (request.path.startsWith("/api/boosts")) {
        response.set("Cache-Control", "no-store");
      }
      return response.status(400).json({ error: "Request body must be valid JSON." });
    }
    next(error);
  };
  app.use(rejectInvalidBody);

  app.use(authRouter);
  app.use(boostsRouter);
  app.use(registerRouter);
  app.use(statusRouter);
  app.use(onlinePlayersRouter);
  app.use(statsDeathsRouter);
  app.use(statsBossKillsRouter);
  app.use(statsQuestCompletionsRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(express.static(clientOutputDir, { index: false }));

  app.get(["/", "/stats", "/login", "/boosts"], (_req, res, next) => {
    res.sendFile(path.join(clientOutputDir, "index.html"), (error) => {
      if (error) {
        next(error);
      }
    });
  });

  return app;
}
