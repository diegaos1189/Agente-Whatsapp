import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../modules/adminUsers/adminAuth.js";
import {
  ADMIN_ROLE,
  STAFF_ROLE,
  PERMISSION_KEYS,
  login,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from "../modules/adminUsers/adminUserService.js";

const ROLE_VALUES = [ADMIN_ROLE, STAFF_ROLE] as const;
const PERMISSION_VALUES = PERMISSION_KEYS as unknown as [string, ...string[]];

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
  role: z.enum(ROLE_VALUES),
  permissions: z.array(z.enum(PERMISSION_VALUES)).default([]),
});

const updateUserSchema = z.object({
  password: z.string().min(4).optional(),
  role: z.enum(ROLE_VALUES).optional(),
  permissions: z.array(z.enum(PERMISSION_VALUES)).optional(),
});

export async function adminUserRoutes(app: FastifyInstance) {
  app.post(
    "/api/admin-users/login",
    // Limite estricto especifico de login: frena fuerza bruta de contrasena incluso si
    // alguien ya tiene el ADMIN_API_TOKEN (ej: filtrado desde el panel admin).
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const body = z.object({ username: z.string(), password: z.string() }).parse(request.body);
      const user = await login(body.username, body.password);
      if (!user) return reply.status(401).send({ error: "Usuario o contrasena incorrectos" });
      return user;
    },
  );

  app.get("/api/admin-users", async (request) => {
    requireAdmin(request);
    return listUsers();
  });

  app.post("/api/admin-users", async (request, reply) => {
    requireAdmin(request);
    const body = createUserSchema.parse(request.body);
    try {
      return await createUser(body);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo crear el usuario" });
    }
  });

  app.patch("/api/admin-users/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateUserSchema.parse(request.body);
    try {
      return await updateUser(id, body);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo actualizar el usuario" });
    }
  });

  app.delete("/api/admin-users/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      await deleteUser(id);
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo eliminar el usuario" });
    }
  });
}
