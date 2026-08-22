// Limite de intentos de login en memoria: sin esto, el endpoint de login del panel
// (el unico expuesto a internet sin token) se puede atacar por fuerza bruta sin limite.
// En memoria alcanza para un solo proceso Next.js (un deploy por cliente); si algun dia
// se corre con varias instancias detras de un balanceador, esto habria que moverlo a Redis.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function isLoginRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginAttempt(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function resetLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
