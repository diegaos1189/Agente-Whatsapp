// Limite de intentos de login en memoria: sin esto, el endpoint de login del panel
// (el unico expuesto a internet sin token) se puede atacar por fuerza bruta sin limite.
// En memoria alcanza para un solo proceso Next.js (un deploy por cliente); si algun dia
// se corre con varias instancias detras de un balanceador, esto habria que moverlo a Redis.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
// Tope de entradas del mapa: sin el, un atacante que rote la IP reportada podria crecer
// la memoria sin limite. Al llegar al tope se purgan las expiradas y, si no alcanza,
// se descartan las mas viejas.
const MAX_TRACKED_KEYS = 5000;

const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * IP del cliente para el rate limit. Los proxies AGREGAN al final de x-forwarded-for,
 * asi que la ultima entrada es la que puso el proxy propio (confiable); la primera la
 * puede inventar el cliente para saltarse el limite con una "IP" nueva en cada intento.
 */
export function clientIpForRateLimit(forwardedFor: string | null): string {
  const entries = (forwardedFor ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return entries[entries.length - 1] || "unknown";
}

function evictIfFull(): void {
  if (attempts.size < MAX_TRACKED_KEYS) return;
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt < now) attempts.delete(key);
  }
  // Map itera en orden de insercion: si sigue lleno, se sacrifican las entradas mas viejas.
  while (attempts.size >= MAX_TRACKED_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function isLoginRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginAttempt(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) {
    evictIfFull();
    attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function resetLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
