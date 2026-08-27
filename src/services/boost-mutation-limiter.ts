const WINDOW_MS = 60_000;
const LIMIT = 5;
const MAX_KEYS = 10_000;

interface WindowRecord {
  count: number;
  resetAt: number;
}

export class BoostMutationLimiter {
  private readonly windows = new Map<string, WindowRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string): boolean {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || now >= current.resetAt) {
      this.prune(now);
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    if (current.count >= LIMIT) {
      return false;
    }
    current.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, record] of this.windows) {
      if (now >= record.resetAt) {
        this.windows.delete(key);
      }
    }
    while (this.windows.size >= MAX_KEYS) {
      const oldest = this.windows.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.windows.delete(oldest);
    }
  }
}

export const boostMutationLimiter = new BoostMutationLimiter();
