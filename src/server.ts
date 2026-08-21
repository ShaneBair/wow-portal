import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registerRouter from "./routes/register.js";
import statusRouter from "./routes/status.js";

const app = express();
const port = Number(process.env.PORT ?? 8090);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../src/public");

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.static(publicDir));

app.use(registerRouter);
app.use(statusRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`WoW Portal listening on port ${port}`);
});
