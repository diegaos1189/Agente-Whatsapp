import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ADMIN_API_TOKEN } from "@/lib/apiServer";
import { SESSION_COOKIE_NAME, decodeSessionPayload } from "@/lib/authConstants";

/**
 * Proxy generico: el navegador llama a /api/proxy/<ruta> sin token, y este route
 * handler reenvia al backend real agregando el Authorization header en el servidor.
 * Asi el ADMIN_API_TOKEN nunca se expone al cliente.
 */
async function forward(request: NextRequest, params: { path: string[] }) {
  const targetPath = `/api/${params.path.join("/")}`;
  const search = request.nextUrl.search;
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  const payloadB64 = sessionCookie.split(".")[0] ?? "";
  const session = payloadB64 ? decodeSessionPayload(payloadB64) : null;

  const hasBody = !["GET", "HEAD", "DELETE"].includes(request.method);
  const body = hasBody ? await request.text() : undefined;

  const res = await fetch(`${API_BASE_URL}${targetPath}${search}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${ADMIN_API_TOKEN}`,
      ...(session
        ? {
            "x-admin-user-id": session.sub,
            "x-admin-username": session.username,
            "x-admin-role": session.role,
            "x-admin-permissions": session.permissions.join(","),
          }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    cache: "no-store",
  });

  const responseBody = await res.text();
  return new NextResponse(responseBody, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}
export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}
