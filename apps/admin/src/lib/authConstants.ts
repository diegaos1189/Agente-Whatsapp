import { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS, type PermissionKey, type AdminRole } from "@pollos/shared";

// Separado de auth.ts a proposito: este archivo lo importa middleware.ts, que corre en
// Edge Runtime y NO soporta node:crypto (que auth.ts si usa). Solo usa Web APIs (btoa/atob,
// TextEncoder) disponibles tanto en Node como en Edge.
export const SESSION_COOKIE_NAME = "admin_session";

export { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS };
export type { PermissionKey };

export interface SessionPayload {
  sub: string;
  username: string;
  role: AdminRole;
  permissions: PermissionKey[];
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
export const ADMIN_ONLY_PREFIXES = ["/settings", "/users"];

export function firstAllowedPath(payload: SessionPayload): string {
  if (payload.role === ADMIN_ROLE) return "/metrics";
  const match = ROUTE_PERMISSIONS.find((r) => payload.permissions.includes(r.permission));
  return match?.prefix ?? "/no-access";
}
