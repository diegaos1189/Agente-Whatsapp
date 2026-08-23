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

function toDTO(user: { id: string; username: string; role: AdminRole; permissions: string[]; createdAt: Date }): AdminUserDTO {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.role === ADMIN_ROLE ? [...PERMISSION_KEYS] : user.permissions,
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

export async function login(username: string, password: string): Promise<AdminUserDTO | null> {
  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return toDTO({ ...user, role: normalizeRole(user.role) });
}

export async function listUsers(): Promise<AdminUserDTO[]> {
  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  return users.map((user) => toDTO({ ...user, role: normalizeRole(user.role) }));
}

export async function createUser(params: {
  username: string;
  password: string;
  role: AdminRole;
  permissions: string[];
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
    },
  });
  return toDTO({ ...user, role: normalizeRole(user.role) });
}

export async function updateUser(
  id: string,
  params: { password?: string; role?: AdminRole; permissions?: string[] },
): Promise<AdminUserDTO> {
  if (params.role === STAFF_ROLE) {
    const current = await prisma.adminUser.findUnique({ where: { id } });
    if (current?.role === ADMIN_ROLE) {
      const remainingAdmins = await prisma.adminUser.count({ where: { role: ADMIN_ROLE, NOT: { id } } });
      if (remainingAdmins === 0) {
        throw new Error("No se puede quitar el rol de administrador al ultimo administrador");
      }
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

export async function deleteUser(id: string): Promise<void> {
  const remaining = await prisma.adminUser.count({ where: { role: ADMIN_ROLE, NOT: { id } } });
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (target?.role === ADMIN_ROLE && remaining === 0) {
    throw new Error("No se puede eliminar el ultimo administrador");
  }
  await prisma.adminUser.delete({ where: { id } });
}
