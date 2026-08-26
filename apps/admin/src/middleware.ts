import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  decodeSessionPayload,
  hasPermission,
  ROUTE_PERMISSIONS,
  ADMIN_ONLY_PREFIXES,
  ADMIN_ROLE,
  firstAllowedPath,
} from "@/lib/authConstants";

// Edge runtime no soporta node:crypto, asi que la firma se re-verifica aqui con Web Crypto.
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  // Pagina publica (landing del negocio) — sin autenticacion, la ve cualquier cliente.
  if (request.nextUrl.pathname === "/") {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET ?? "";
  const isProduction = process.env.NODE_ENV === "production";

  // En desarrollo local permitimos arrancar sin secreto para no frenar onboarding.
  // En produccion, en cambio, fallamos cerrado: sin SESSION_SECRET no se puede confiar
  // en la cookie de sesion del panel.
  if (!secret && !isProduction) {
    return NextResponse.next();
  }

  if (!secret && isProduction) {
    return NextResponse.redirect(new URL("/login?error=session-config", request.url));
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  const [payloadB64, signature] = cookieValue.split(".");

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);

  if (!payloadB64 || !signature) {
    return NextResponse.redirect(loginUrl);
  }

  const expectedSignature = await hmacHex(secret, payloadB64);
  if (signature !== expectedSignature) {
    return NextResponse.redirect(loginUrl);
  }

  const payload = decodeSessionPayload(payloadB64);
  if (!payload) {
    return NextResponse.redirect(loginUrl);
  }

  const path = request.nextUrl.pathname;

  if (ADMIN_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) && payload.role !== ADMIN_ROLE) {
    return NextResponse.redirect(new URL(firstAllowedPath(payload), request.url));
  }

  const routeRule = ROUTE_PERMISSIONS.find((r) => path.startsWith(r.prefix));
  if (routeRule && !hasPermission(payload, routeRule.permission)) {
    return NextResponse.redirect(new URL("/no-access", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/login|api/public-settings|_next/static|_next/image|favicon.ico|icon.svg|$).*)"],
};
