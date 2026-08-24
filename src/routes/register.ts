import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createAccount } from "../services/azerothcore.js";

const router = Router();

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

function validUsername(value: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

function validPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 64 && !/[\r\n]/.test(value);
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.post("/api/register", registrationLimiter, async (req, res) => {
  const username = String(req.body?.username ?? "").trim().toUpperCase();
  const password = String(req.body?.password ?? "");
  const confirmPassword = String(req.body?.confirmPassword ?? "");
  const email = String(req.body?.email ?? "").trim();
  const inviteCode = String(req.body?.inviteCode ?? "");

  if (!process.env.INVITE_CODE || inviteCode !== process.env.INVITE_CODE) {
    return res.status(403).json({ error: "Invalid invite code." });
  }

  if (!validUsername(username)) {
    return res.status(400).json({
      error: "Username must be 3-16 characters using letters, numbers, or underscores."
    });
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: "Password must be between 8 and 64 characters."
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match." });
  }

  if (!validEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    const result = await createAccount(username, password, email);

    if (!result.ok) {
      console.error("AzerothCore account creation failed.");
      return res.status(502).json({
        error: "The game server could not create that account. The username may already exist."
      });
    }

    return res.status(201).json({
      message: "Account created! You can now log into DaBoysZeroth."
    });
  } catch (error) {
    const errorKind = error instanceof Error ? error.name : "UnknownError";
    console.error(`Registration request failed (${errorKind}).`);
    return res.status(502).json({
      error: "Unable to reach the game server. Try again later."
    });
  }
});

export default router;
