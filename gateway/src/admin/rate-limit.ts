/**
 * Per-IP rate limiter for the admin login endpoint.
 *
 * Single process, in-memory. Fine for a single Fly machine; if we ever
 * scale to multiple instances we'd need to move this into a shared store
 * (Redis, Upstash, etc.).
 *
 * Policy: after 5 failed password attempts in a 15-minute window, the
 * source IP is locked out for 15 minutes. Successful login resets the
 * counter.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Entry {
  firstAttempt: number;
  attempts: number;
  lockedUntil?: number;
}

const store = new Map<string, Entry>();

export interface RateLimitCheck {
  allowed: boolean;
  retryAfterSeconds?: number;
}

function gc(now: number): void {
  // Remove entries that are both outside the window and not locked.
  for (const [key, entry] of store.entries()) {
    const windowExpired = now - entry.firstAttempt > WINDOW_MS;
    const lockExpired = !entry.lockedUntil || entry.lockedUntil < now;
    if (windowExpired && lockExpired) {
      store.delete(key);
    }
  }
}

export function checkLoginAllowed(ip: string): RateLimitCheck {
  const now = Date.now();
  gc(now);
  const entry = store.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }
  // If the window has expired, reset.
  if (now - entry.firstAttempt > WINDOW_MS) {
    store.delete(ip);
    return { allowed: true };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000),
    };
  }
  return { allowed: true };
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = store.get(ip);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    store.set(ip, { firstAttempt: now, attempts: 1 });
    return;
  }
  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordLoginSuccess(ip: string): void {
  store.delete(ip);
}
