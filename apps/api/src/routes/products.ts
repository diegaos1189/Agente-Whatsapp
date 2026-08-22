import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  listCatalog,
  listActivePromotions,
  listAllPromotions,
  invalidateCatalogCache,
} from "../modules/products/productService.js";
import { invalidateBusinessSettingsCache } from "../modules/business/businessHoursService.js";

const comboItemSchema = z.object({ productId: z.string(), quantity: z.number().int().positive() });

const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.number().int().positive().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isDefaultVariant: z.boolean().optional(),
  searchKeywords: z.string().nullable().optional(),
  unitCount: z.number().int().positive().nullable().optional(),
  isCombo: z.boolean().optional(),
  comboItems: z.array(comboItemSchema).max(6, "Maximo 6 productos por combo").optional(),
  showInMenu: z.boolean().optional(),
});

const productCreateSchema = z.object({
  categoryId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unitCount: z.number().int().positive().nullable().optional(),
  isCombo: z.boolean().optional(),
  comboItems: z.array(comboItemSchema).max(6, "Maximo 6 productos por combo").optional(),
  price: z.number().int().positive(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  searchKeywords: z.string().nullable().optional(),
});

const categoryCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug solo puede tener minusculas, numeros y guiones"),
  sortOrder: z.number().int().optional(),
});

const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

const promotionCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  productId: z.string().nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).nullable().optional(),
  discountValue: z.number().int().nonnegative().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const promotionUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  productId: z.string().nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).nullable().optional(),
  discountValue: z.number().int().nonnegative().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const recommendationCreateSchema = z
  .object({
    sourceProductId: z.string().nullable().optional(),
    sourceCategoryId: z.string().nullable().optional(),
    recommendedProductId: z.string(),
    recommendationType: z.enum(["UPSELL", "CROSS_SELL", "ADD_ON"]),
    priority: z.number().int().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.sourceProductId) !== Boolean(body.sourceCategoryId), {
    message: "Debes elegir exactamente un origen: un producto o una categoria (no ambos, no ninguno)",
  });

const recommendationUpdateSchema = z.object({
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
  recommendationType: z.enum(["UPSELL", "CROSS_SELL", "ADD_ON"]).optional(),
});

export async function productRoutes(app: FastifyInstance) {
  // El agente ya recarga catalogo/configuracion solo (el cache se invalida en cada guardado),
  // pero este endpoint fuerza el refresco y confirma al admin que el agente quedo al dia.
  app.post("/api/agent/refresh", async () => {
    invalidateCatalogCache();
    invalidateBusinessSettingsCache();
    const categories = await listCatalog();
    const productsCount = categories.reduce((acc, c) => acc + c.products.length, 0);
    return { ok: true, categoriesCount: categories.length, productsCount };
  });

  app.get("/api/products", async () => listCatalog());

  app.get("/api/promotions", async () => listActivePromotions());

  app.get("/api/promotions/all", async () => listAllPromotions());

  app.get("/api/categories", async () => {
    return prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  });

  app.post("/api/categories", async (request, reply) => {
    const body = categoryCreateSchema.parse(request.body);
    const existing = await prisma.category.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.status(409).send({ error: "Ya existe una categoria con ese slug" });
    const category = await prisma.category.create({ data: body });
    invalidateCatalogCache();
    return category;
  });

  app.patch("/api/categories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = categoryUpdateSchema.parse(request.body);
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return reply.status(404).send({ error: "Categoria no encontrada" });

    const updated = await prisma.category.update({ where: { id }, data: body });
    invalidateCatalogCache();
    return updated;
  });

  app.delete("/api/categories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return reply.status(404).send({ error: "Categoria no encontrada" });

    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      return reply
        .status(409)
        .send({ error: `Esta categoria tiene ${productCount} producto(s) asociado(s). Mueve o elimina esos productos primero.` });
    }

    await prisma.category.delete({ where: { id } });
    invalidateCatalogCache();
    return { ok: true };
  });

  app.post("/api/products", async (request) => {
    const body = productCreateSchema.parse(request.body);
    const product = await prisma.product.create({ data: body });
    invalidateCatalogCache();
    return product;
  });

  app.patch("/api/products/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = productUpdateSchema.parse(request.body);

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return reply.status(404).send({ error: "Producto no encontrado" });

    const updated = await prisma.product.update({ where: { id }, data: body });
    invalidateCatalogCache();
    return updated;
  });

  app.delete("/api/products/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return reply.status(404).send({ error: "Producto no encontrado" });

    try {
      await prisma.product.delete({ where: { id } });
    } catch (error) {
      // P2003: viola una relacion (ej: el producto ya aparece en pedidos o promociones
      // existentes) — no se puede borrar sin perder ese historial. Se le sugiere
      // deshabilitarlo en vez de forzar el borrado.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return reply.status(409).send({
          error: "Este producto ya se uso en pedidos o promociones existentes, no se puede eliminar. Deshabilitalo en su lugar (columna Disponible).",
        });
      }
      throw error;
    }

    invalidateCatalogCache();
    return { ok: true };
  });

  app.post("/api/promotions", async (request) => {
    const body = promotionCreateSchema.parse(request.body);
    return prisma.promotion.create({
      data: {
        ...body,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
    });
  });

  app.patch("/api/promotions/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = promotionUpdateSchema.parse(request.body);

    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) return reply.status(404).send({ error: "Promocion no encontrada" });

    return prisma.promotion.update({
      where: { id },
      data: {
        ...body,
        startsAt: body.startsAt === undefined ? undefined : body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt === undefined ? undefined : body.endsAt ? new Date(body.endsAt) : null,
      },
    });
  });

  app.delete("/api/promotions/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const promotion = await prisma.promotion.findUnique({ where: { id } });
    if (!promotion) return reply.status(404).send({ error: "Promocion no encontrada" });

    await prisma.promotion.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Reglas de recomendacion (upsell/cross-sell), ver recommendationService.ts ----------

  app.get("/api/recommendations", async () => {
    const rows = await prisma.productRecommendation.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        sourceProduct: { select: { name: true } },
        sourceCategory: { select: { name: true } },
        recommendedProduct: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      sourceProductId: row.sourceProductId,
      sourceProductName: row.sourceProduct?.name ?? null,
      sourceCategoryId: row.sourceCategoryId,
      sourceCategoryName: row.sourceCategory?.name ?? null,
      recommendedProductId: row.recommendedProductId,
      recommendedProductName: row.recommendedProduct.name,
      recommendationType: row.recommendationType,
      priority: row.priority,
      active: row.active,
    }));
  });

  app.post("/api/recommendations", async (request, reply) => {
    const body = recommendationCreateSchema.parse(request.body);
    if (body.recommendedProductId === body.sourceProductId) {
      return reply.status(400).send({ error: "El producto recomendado no puede ser el mismo que el de origen" });
    }
    const created = await prisma.productRecommendation.create({
      data: {
        sourceProductId: body.sourceProductId ?? null,
        sourceCategoryId: body.sourceCategoryId ?? null,
        recommendedProductId: body.recommendedProductId,
        recommendationType: body.recommendationType,
        priority: body.priority ?? 0,
        active: body.active ?? true,
      },
    });
    return created;
  });

  app.patch("/api/recommendations/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = recommendationUpdateSchema.parse(request.body);
    const rule = await prisma.productRecommendation.findUnique({ where: { id } });
    if (!rule) return reply.status(404).send({ error: "Regla de recomendacion no encontrada" });

    return prisma.productRecommendation.update({ where: { id }, data: body });
  });

  app.delete("/api/recommendations/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const rule = await prisma.productRecommendation.findUnique({ where: { id } });
    if (!rule) return reply.status(404).send({ error: "Regla de recomendacion no encontrada" });

    await prisma.productRecommendation.delete({ where: { id } });
    return { ok: true };
  });
}
