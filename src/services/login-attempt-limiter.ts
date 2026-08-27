import { createHash } from "node:crypto";

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_FAILURE_LIMIT = 5;
const IP_ATTEMPT_LIMIT = 10;
const MAX_KEYS = 10_000;

interface AttemptBucket {
  count: number;
  expiresAt: number;
}

function keyDigest(kind: "account" | "ip", value: string): string {
  return createHash("sha256").update(`${kind}:${value}`, "utf8").digest("hex");
}

export class LoginAttemptLimiter {
  private readonly accountFailures = new Map<string, AttemptBucket>();
  private readonly ipAttempts = new Map<string, AttemptBucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consumeIpAttempt(ip: string): boolean {
    return this.consume(this.ipAttempts, keyDigest("ip", ip), IP_ATTEMPT_LIMIT);
  }

  isAccountBlocked(username: string): boolean {
    const bucket = this.read(this.accountFailures, keyDigest("account", username));
    return (bucket?.count ?? 0) >= ACCOUNT_FAILURE_LIMIT;
  }

  recordAccountFailure(username: string): void {
    this.consume(this.accountFailures, keyDigest("account", username), Number.MAX_SAFE_INTEGER);
  }

  private consume(store: Map<string, AttemptBucket>, key: string, limit: number): boolean {
    const existing = this.read(store, key);
    if (existing && existing.count >= limit) {
      return false;
    }
    if (!existing && store.size >= MAX_KEYS) {
      this.prune(store);
      if (store.size >= MAX_KEYS) {
        const oldest = store.keys().next().value as string | undefined;
        if (oldest) {
          store.delete(oldest);
        }
      }
    }
    const now = this.now();
    store.set(key, existing
      ? { count: existing.count + 1, expiresAt: existing.expiresAt }
      : { count: 1, expiresAt: now + WINDOW_MS });
    return true;
  }

  private read(store: Map<string, AttemptBucket>, key: string): AttemptBucket | undefined {
    const bucket = store.get(key);
    if (bucket && this.now() >= bucket.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return bucket;
  }

  private prune(store: Map<string, AttemptBucket>): void {
    const now = this.now();
    for (const [key, bucket] of store) {
      if (now >= bucket.expiresAt) {
        store.delete(key);
      }
    }
  }
}

export const loginAttemptLimiter = new LoginAttemptLimiter();
