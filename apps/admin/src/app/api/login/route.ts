import { NextRequest, NextResponse } from "next/server";
import { assertSessionSecretAvailable, checkCredentials, signSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { firstAllowedPath, type PermissionKey } from "@/lib/authConstants";
import { clientIpForRateLimit, isLoginRateLimited, recordLoginAttempt, resetLoginAttempts } from "@/lib/loginRateLimit";

export async function POST(request: NextRequest) {
  try {
    assertSessionSecretAvailable();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuracion de sesion invalida" }, { status: 503 });
  }

  const ip = clientIpForRateLimit(request.headers.get("x-forwarded-for"));

  if (isLoginRateLimited(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." }, { status: 429 });
  }

  const { username, password } = (await request.json()) as { username?: string; password?: string };

  if (!username || !password) {
    recordLoginAttempt(ip);
    return NextResponse.json({ error: "Usuario o contrasena incorrectos" }, { status: 401 });
  }

  const user = await checkCredentials(username, password);
  if (!user) {
    recordLoginAttempt(ip);
    return NextResponse.json({ error: "Usuario o contrasena incorrectos" }, { status: 401 });
  }

  resetLoginAttempts(ip);

  // El usuario de un restaurante entra directo a su panel (/<slug>/...), no al de la raiz.
  const redirectTo = firstAllowedPath({
    sub: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions as PermissionKey[],
    restaurantId: user.restaurantId ?? null,
    restaurantSlug: user.restaurantSlug ?? null,
    iat: Date.now(),
  });
  const response = NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(SESSION_COOKIE_NAME, signSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
