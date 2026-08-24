import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import onlinePlayersRouter from "./routes/online-players.js";
import registerRouter from "./routes/register.js";
import statusRouter from "./routes/status.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../src/public");

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.static(publicDir));

  app.use(registerRouter);
  app.use(statusRouter);
  app.use(onlinePlayersRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
