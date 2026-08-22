import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, decodeSessionPayload, type SessionPayload } from "./authConstants";

/** Lee la sesion ya verificada por el middleware (no re-verifica la firma aqui). */
export function getSession(): SessionPayload | null {
  const value = cookies().get(SESSION_COOKIE_NAME)?.value ?? "";
  const [payloadB64] = value.split(".");
  if (!payloadB64) return null;
  return decodeSessionPayload(payloadB64);
}
