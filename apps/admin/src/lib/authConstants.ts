import { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS, type PermissionKey, type AdminRole } from "@pollos/shared";

// Separado de auth.ts a proposito: este archivo lo importa middleware.ts, que corre en
// Edge Runtime y NO soporta node:crypto (que auth.ts si usa). Solo usa Web APIs (btoa/atob,
// TextEncoder) disponibles tanto en Node como en Edge.
export const SESSION_COOKIE_NAME = "admin_session";

// Vida maxima de una sesion firmada. Debe coincidir con el maxAge de la cookie en
// /api/login: sin este chequeo, un token robado seria valido para siempre aunque la
// cookie del navegador expire (la firma HMAC no caduca sola).
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isSessionExpired(payload: SessionPayload, now = Date.now()): boolean {
  return typeof payload.iat !== "number" || payload.iat > now || now - payload.iat > SESSION_MAX_AGE_MS;
}

export { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS };
export type { PermissionKey };

export interface SessionPayload {
  sub: string;
  username: string;
  role: AdminRole;
  permissions: PermissionKey[];
  /**
   * Restaurante al que pertenece el usuario, o null si es de la plataforma (el dueño del
   * producto). Va firmado dentro de la sesion, no en un header suelto: es lo que decide a
   * que panel entra y de cual no puede salir.
   */
  restaurantId?: string | null;
  /** Slug del restaurante del usuario, para armar los links de su panel sin ir a la API. */
  restaurantSlug?: string | null;
  iat: number;
}

export function base64UrlEncode(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeSessionPayload(payload: SessionPayload): string {
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeSessionPayload(payloadB64: string): SessionPayload | null {
  try {
    return JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
  } catch {
    return null;
  }
}

export function hasPermission(payload: SessionPayload, key: PermissionKey): boolean {
  return payload.role === ADMIN_ROLE || payload.permissions.includes(key);
}

export const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: PermissionKey }> = [
  { prefix: "/metrics", permission: "metrics" },
  { prefix: "/conversations", permission: "conversations" },
  { prefix: "/orders", permission: "orders" },
  { prefix: "/products", permission: "products" },
  { prefix: "/recommendations", permission: "products" },
  { prefix: "/promotions", permission: "promotions" },
  { prefix: "/faqs", permission: "faqs" },
  { prefix: "/kitchen", permission: "kitchen" },
  { prefix: "/facturacion", permission: "facturacion" },
];

/** Rutas que solo puede ver/editar el rol ADMIN, sin excepcion. */
export const ADMIN_ONLY_PREFIXES = ["/settings", "/users", "/super-admin"];

/**
 * Primer segmento de una URL del panel que NO es un slug de restaurante.
 *
 * El middleware corre en Edge y no puede consultar la base, asi que no puede preguntar si
 * "delycombos" es un restaurante. Lo resuelve al reves: la lista de secciones es fija y esta
 * en el codigo, asi que todo primer segmento que no sea una de estas es un slug. Por eso
 * uniqueSlug() en la API las trata como reservadas — un negocio llamado "Pedidos" no puede
 * quedarse con el slug "orders".
 */
export const PANEL_SECTIONS = [
  "metrics",
  "conversations",
  "orders",
  "products",
  "promotions",
  "recommendations",
  "faqs",
  "kitchen",
  "facturacion",
  "capacitacion",
  "settings",
  "users",
  "super-admin",
  "no-access",
  "login",
  "api",
] as const;

/**
 * Seccion del panel a la que apunta una ruta, sin importar si viene del panel de la raiz
 * (/orders) o del de un restaurante (/delycombos/orders).
 *
 * El middleware lo necesita porque sus reglas son por seccion: con el slug adelante, un
 * startsWith("/orders") deja de coincidir y un STAFF sin permisos entraria a cualquier
 * seccion del panel de un restaurante.
 */
export function sectionPathOf(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) return "/";
  if ((PANEL_SECTIONS as readonly string[]).includes(first)) return pathname;
  return `/${segments.slice(1).join("/")}`;
}

/** Slug del restaurante que se esta abriendo en esta ruta, o null si es el panel de la raiz. */
export function restaurantSlugOf(pathname: string): string | null {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return null;
  return (PANEL_SECTIONS as readonly string[]).includes(first) ? null : first;
}

export function firstAllowedPath(payload: SessionPayload): string {
  const base = payload.restaurantSlug ? `/${payload.restaurantSlug}` : "";
  if (payload.role === ADMIN_ROLE) return `${base}/metrics`;
  const match = ROUTE_PERMISSIONS.find((r) => payload.permissions.includes(r.permission));
  return match ? `${base}${match.prefix}` : `${base}/no-access`;
}
