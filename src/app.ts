import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import onlinePlayersRouter from "./routes/online-players.js";
import registerRouter from "./routes/register.js";
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

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.use(registerRouter);
  app.use(statusRouter);
  app.use(onlinePlayersRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(express.static(clientOutputDir, { index: false }));

  app.get(["/", "/stats"], (_req, res, next) => {
    res.sendFile(path.join(clientOutputDir, "index.html"), (error) => {
      if (error) {
        next(error);
      }
    });
  });

  return app;
}
