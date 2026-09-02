import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS, type PermissionKey, type AdminRole } from "@pollos/shared";
import { prisma } from "../../db/prisma.js";

export { ADMIN_ROLE, STAFF_ROLE, PERMISSION_KEYS };
export type { PermissionKey };

export interface AdminUserDTO {
  id: string;
  username: string;
  role: AdminRole;
  permissions: string[];
  /** Restaurante al que pertenece, o null si es un usuario de la plataforma. */
  restaurantId: string | null;
  /**
   * Slug del restaurante, para que el panel pueda mandar al usuario directo a /<slug> apenas
   * entra. Viene en la respuesta del login porque en ese momento todavia no hay sesion con
   * la cual consultar las rutas de plataforma.
   */
  restaurantSlug: string | null;
  createdAt: string;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function normalizeRole(role: string): AdminRole {
  return role === ADMIN_ROLE ? ADMIN_ROLE : STAFF_ROLE;
}

function toDTO(user: {
  id: string;
  username: string;
  role: AdminRole;
  permissions: string[];
  restaurantId: string | null;
  restaurant?: { slug: string } | null;
  createdAt: Date;
}): AdminUserDTO {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.role === ADMIN_ROLE ? [...PERMISSION_KEYS] : user.permissions,
    restaurantId: user.restaurantId,
    restaurantSlug: user.restaurant?.slug ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Si no existe ningun usuario admin todavia, crea uno con las credenciales de bootstrap del .env. */
export async function ensureBootstrapAdmin(username: string, password: string): Promise<void> {
  const count = await prisma.adminUser.count();
  if (count > 0) return;
  if (!username || !password) return;

  await prisma.adminUser.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      role: ADMIN_ROLE,
      permissions: [...PERMISSION_KEYS],
    },
  });
}

/**
 * El usuario es unico por nombre en todo el deployment (no por restaurante): el login pide
 * usuario y contrasena, sin decir de que negocio es, asi que dos "admin" en restaurantes
 * distintos serian indistinguibles al entrar.
 */
export async function login(username: string, password: string): Promise<AdminUserDTO | null> {
  const user = await prisma.adminUser.findUnique({
    where: { username },
    include: { restaurant: { select: { slug: true } } },
  });
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return toDTO({ ...user, role: normalizeRole(user.role) });
}

/** Usuarios de un restaurante, o los de la plataforma cuando restaurantId es null. */
export async function listUsers(restaurantId: string | null): Promise<AdminUserDTO[]> {
  const users = await prisma.adminUser.findMany({ where: { restaurantId }, orderBy: { createdAt: "asc" } });
  return users.map((user) => toDTO({ ...user, role: normalizeRole(user.role) }));
}

export async function createUser(params: {
  username: string;
  password: string;
  role: AdminRole;
  permissions: string[];
  restaurantId: string | null;
}): Promise<AdminUserDTO> {
  const existing = await prisma.adminUser.findUnique({ where: { username: params.username } });
  if (existing) {
    throw new Error("Ese usuario ya se encuentra registrado");
  }

  const user = await prisma.adminUser.create({
    data: {
      username: params.username,
      passwordHash: hashPassword(params.password),
      role: params.role,
      permissions: params.role === ADMIN_ROLE ? [] : params.permissions,
      restaurantId: params.restaurantId,
    },
  });
  return toDTO({ ...user, role: normalizeRole(user.role) });
}

export async function updateUser(
  id: string,
  restaurantId: string | null,
  params: { password?: string; role?: AdminRole; permissions?: string[] },
): Promise<AdminUserDTO> {
  // La busqueda va acotada al restaurante: sin esto, el admin de un negocio podria cambiarle
  // la contrasena al usuario de otro sabiendo su id.
  const current = await prisma.adminUser.findFirst({ where: { id, restaurantId } });
  if (!current) {
    throw new Error("Usuario no encontrado");
  }

  // La regla del "ultimo administrador" tambien es por restaurante: dejar sin admin al
  // negocio A no puede depender de cuantos admins tenga el negocio B.
  if (params.role === STAFF_ROLE && current.role === ADMIN_ROLE) {
    const remainingAdmins = await prisma.adminUser.count({
      where: { restaurantId, role: ADMIN_ROLE, NOT: { id } },
    });
    if (remainingAdmins === 0) {
      throw new Error("No se puede quitar el rol de administrador al ultimo administrador");
    }
  }

  const user = await prisma.adminUser.update({
    where: { id },
    data: {
      ...(params.password ? { passwordHash: hashPassword(params.password) } : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.permissions ? { permissions: params.permissions } : {}),
    },
  });
  return toDTO({ ...user, role: normalizeRole(user.role) });
}

export async function deleteUser(id: string, restaurantId: string | null): Promise<void> {
  const target = await prisma.adminUser.findFirst({ where: { id, restaurantId } });
  if (!target) {
    throw new Error("Usuario no encontrado");
  }
  const remaining = await prisma.adminUser.count({ where: { restaurantId, role: ADMIN_ROLE, NOT: { id } } });
  if (target.role === ADMIN_ROLE && remaining === 0) {
    throw new Error("No se puede eliminar el ultimo administrador");
  }
  await prisma.adminUser.delete({ where: { id } });
}
