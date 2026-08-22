import { createHmac } from "node:crypto";
import { apiServerFetch } from "./apiServer";
import {
  SESSION_COOKIE_NAME,
  encodeSessionPayload,
  type SessionPayload,
  type PermissionKey,
} from "./authConstants";

export { SESSION_COOKIE_NAME } from "./authConstants";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
const isProduction = process.env.NODE_ENV === "production";

export function isSessionSecretConfigured(): boolean {
  return SESSION_SECRET.trim().length > 0;
}

export function assertSessionSecretAvailable(): void {
  if (isProduction && !isSessionSecretConfigured()) {
    throw new Error("SESSION_SECRET es obligatorio en produccion para proteger el panel administrativo");
  }
}

interface LoginResult {
  id: string;
  username: string;
  role: "ADMIN" | "STAFF";
  permissions: string[];
}

/** Verifica usuario/contrasena contra la tabla admin_users del backend. */
export async function checkCredentials(username: string, password: string): Promise<LoginResult | null> {
  try {
    return await apiServerFetch<LoginResult>("/api/admin-users/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return null;
  }
}

/** Firma un token de sesion (payload + HMAC-SHA256) que la Edge middleware puede re-verificar sin node:crypto. */
export function signSessionToken(user: LoginResult): string {
  assertSessionSecretAvailable();
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions as PermissionKey[],
    iat: Date.now(),
  };
  const payloadB64 = encodeSessionPayload(payload);
  const signature = createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("hex");
  return `${payloadB64}.${signature}`;
}
