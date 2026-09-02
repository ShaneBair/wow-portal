const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 10;
const MAX_KEYS = 20_000;

interface WindowRecord { count: number; resetAt: number }

export class AccountPasswordLimiter {
  private readonly windows = new Map<string, WindowRecord>();
  constructor(private readonly now: () => number = Date.now) {}

  consume(accountId: number, ip: string): boolean {
    const now = this.now();
    this.prune(now);
    const accountKey = `account:${accountId}`;
    const ipKey = `ip:${ip}`;
    if (this.blocked(accountKey, ACCOUNT_LIMIT, now) || this.blocked(ipKey, IP_LIMIT, now)) {
      return false;
    }
    this.increment(accountKey, now);
    this.increment(ipKey, now);
    return true;
  }

  private blocked(key: string, limit: number, now: number): boolean {
    const record = this.windows.get(key);
    return Boolean(record && now < record.resetAt && record.count >= limit);
  }

  private increment(key: string, now: number): void {
    const record = this.windows.get(key);
    if (!record || now >= record.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      record.count += 1;
    }
  }

  private prune(now: number): void {
    for (const [key, record] of this.windows) if (now >= record.resetAt) this.windows.delete(key);
    while (this.windows.size >= MAX_KEYS) {
      const key = this.windows.keys().next().value as string | undefined;
      if (!key) break;
      this.windows.delete(key);
    }
  }
}

export const accountPasswordLimiter = new AccountPasswordLimiter();
