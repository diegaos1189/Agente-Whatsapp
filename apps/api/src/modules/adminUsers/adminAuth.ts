import type { FastifyRequest } from "fastify";
import { ADMIN_ROLE, type AdminRole, type PermissionKey } from "@pollos/shared";

interface AuthorizationError extends Error {
  statusCode: number;
}

interface AdminActor {
  id: string;
  username: string;
  role: AdminRole | "";
  permissions: string[];
  /**
   * Restaurante al que pertenece el usuario, o null si es de la plataforma (el dueño del
   * producto, que entra al panel de cualquier cliente). Es lo que impide que el usuario de
   * un negocio pida los datos de otro cambiando el header del navegador.
   */
  restaurantId: string | null;
}

export function createAuthorizationError(message = "No autorizado", statusCode = 403): AuthorizationError {
  const error = new Error(message) as AuthorizationError;
  error.statusCode = statusCode;
  return error;
}

function readHeader(request: FastifyRequest, header: string): string {
  return String(request.headers[header] ?? "").trim();
}

export function getAdminActor(request: FastifyRequest): AdminActor {
  return {
    id: readHeader(request, "x-admin-user-id"),
    username: readHeader(request, "x-admin-username"),
    role: readHeader(request, "x-admin-role") as AdminActor["role"],
    permissions: readHeader(request, "x-admin-permissions")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    restaurantId: readHeader(request, "x-admin-restaurant-id") || null,
  };
}

export function requireAdmin(request: FastifyRequest): void {
  const actor = getAdminActor(request);
  if (actor.role !== ADMIN_ROLE) {
    throw createAuthorizationError();
  }
}

/**
 * Solo el dueño de la plataforma: rol ADMIN y sin restaurante propio.
 *
 * requireAdmin() no alcanza para las pantallas de la plataforma (lista de clientes, leads):
 * el dueño de un restaurante tambien puede ser ADMIN *de su negocio*, y con requireAdmin
 * a secas veria la cartera completa de clientes del producto.
 */
export function requirePlatformAdmin(request: FastifyRequest): void {
  const actor = getAdminActor(request);
  if (actor.role !== ADMIN_ROLE || actor.restaurantId) {
    throw createAuthorizationError();
  }
}

export function requireAuthenticated(request: FastifyRequest): void {
  const actor = getAdminActor(request);
  if (!actor.role) {
    throw createAuthorizationError();
  }
}

export function requirePermission(request: FastifyRequest, permission: PermissionKey): void {
  const actor = getAdminActor(request);
  if (actor.role === ADMIN_ROLE) return;
  if (!actor.role || !actor.permissions.includes(permission)) {
    throw createAuthorizationError();
  }
}

export function requireAnyPermission(request: FastifyRequest, permissions: PermissionKey[]): void {
  const actor = getAdminActor(request);
  if (actor.role === ADMIN_ROLE) return;
  if (!actor.role || !permissions.some((permission) => actor.permissions.includes(permission))) {
    throw createAuthorizationError();
  }
}
