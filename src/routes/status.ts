import { Router } from "express";
import { getServerInfo } from "../services/azerothcore.js";

const router = Router();

router.get("/api/status", async (_req, res) => {
  try {
    const result = await getServerInfo();

    if (!result.ok) {
      return res.status(503).json({ online: false });
    }

    return res.json({ online: true });
  } catch {
    return res.status(503).json({ online: false });
  }
});

export default router;
