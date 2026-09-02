import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  decodeSessionPayload,
  hasPermission,
  isSessionExpired,
  ROUTE_PERMISSIONS,
  ADMIN_ONLY_PREFIXES,
  ADMIN_ROLE,
  firstAllowedPath,
  restaurantSlugOf,
  sectionPathOf,
  type SessionPayload,
} from "@/lib/authConstants";

// Comparacion en tiempo constante (Edge no tiene crypto.timingSafeEqual): recorre siempre
// la cadena completa en vez de cortar en la primera diferencia, para no filtrar por timing
// cuantos caracteres de la firma coinciden.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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

/**
 * Un usuario atado a un restaurante solo existe dentro de su panel.
 *
 * Devuelve la URL a la que hay que mandarlo si se salio (el panel de otro cliente, las
 * pantallas de la plataforma, o el panel de la raiz, que es el del restaurante de este
 * deployment), o null si donde esta es suyo. Es la contraparte visible del corte que ya hace
 * la API: aca se evita la pantalla en blanco, alla se evita la fuga de datos.
 */
function outOfScopeRedirect(payload: SessionPayload, pathname: string): string | null {
  if (!payload.restaurantId) return null;

  const ownSlug = payload.restaurantSlug ?? null;
  const slugInPath = restaurantSlugOf(pathname);

  // Sin slug propio (restaurante recien renombrado, sesion vieja) no se puede saber cual es
  // su panel: se lo deja pasar y la API igual le acota los datos a su restaurante.
  if (!ownSlug) return null;

  if (slugInPath === ownSlug) return null;
  return firstAllowedPath(payload);
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
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return NextResponse.redirect(loginUrl);
  }

  const payload = decodeSessionPayload(payloadB64);
  if (!payload || isSessionExpired(payload)) {
    return NextResponse.redirect(loginUrl);
  }

  const path = request.nextUrl.pathname;

  // Primero el limite de restaurante: un usuario de un negocio no tiene por que llegar
  // siquiera a la evaluacion de permisos del panel de otro.
  const outOfScope = outOfScopeRedirect(payload, path);
  if (outOfScope && outOfScope !== path) {
    return NextResponse.redirect(new URL(outOfScope, request.url));
  }

  // Las reglas son por seccion, y la seccion es la misma se entre por /orders o por
  // /delycombos/orders.
  const section = sectionPathOf(path);

  if (ADMIN_ONLY_PREFIXES.some((prefix) => section.startsWith(prefix)) && payload.role !== ADMIN_ROLE) {
    return NextResponse.redirect(new URL(firstAllowedPath(payload), request.url));
  }

  const routeRule = ROUTE_PERMISSIONS.find((r) => section.startsWith(r.prefix));
  if (routeRule && !hasPermission(payload, routeRule.permission)) {
    const base = payload.restaurantSlug ? `/${payload.restaurantSlug}` : "";
    return NextResponse.redirect(new URL(`${base}/no-access`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/login|api/public-settings|api/public-lead|_next/static|_next/image|favicon.ico|icon.svg|$).*)"],
};
