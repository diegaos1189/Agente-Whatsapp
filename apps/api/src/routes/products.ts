import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAnyPermission, requirePermission } from "../modules/adminUsers/adminAuth.js";
import { prisma } from "../db/prisma.js";
import {
  listCatalog,
  listActivePromotions,
  listAllPromotions,
  invalidateCatalogCache,
} from "../modules/products/productService.js";
import { invalidateBusinessSettingsCache } from "../modules/business/businessHoursService.js";
import { resolveRestaurantId } from "../modules/platform/restaurantContext.js";

const comboItemSchema = z.object({ productId: z.string(), quantity: z.number().int().positive() });

const productUpdateSchema = z.object({
  categoryId: z.string().optional(),
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
  parentCategoryId: z.string().nullable().optional(),
});

const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  parentCategoryId: z.string().nullable().optional(),
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
  app.post("/api/agent/refresh", async (request) => {
    requirePermission(request, "products");
    const restaurantId = await resolveRestaurantId(request);
    invalidateCatalogCache(restaurantId);
    invalidateBusinessSettingsCache(restaurantId);
    const categories = await listCatalog(restaurantId);
    const productsCount = categories.reduce((acc, c) => acc + c.products.length, 0);
    return { ok: true, categoriesCount: categories.length, productsCount };
  });

  app.get("/api/products", async (request) => {
    requireAnyPermission(request, ["products", "promotions", "orders", "conversations"]);
    return listCatalog(await resolveRestaurantId(request));
  });

  app.get("/api/promotions", async (request) => {
    requirePermission(request, "promotions");
    return listActivePromotions(await resolveRestaurantId(request));
  });

  app.get("/api/promotions/all", async (request) => {
    requirePermission(request, "promotions");
    return listAllPromotions(await resolveRestaurantId(request));
  });

  app.get("/api/categories", async (request) => {
    requireAnyPermission(request, ["products", "promotions", "orders", "conversations"]);
    const restaurantId = await resolveRestaurantId(request);
    return prisma.category.findMany({ where: { restaurantId }, orderBy: { sortOrder: "asc" } });
  });

  app.post("/api/categories", async (request, reply) => {
    requirePermission(request, "products");
    const body = categoryCreateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);
    // El slug es unico POR restaurante: dos negocios pueden tener ambos "bebidas".
    const existing = await prisma.category.findFirst({ where: { restaurantId, slug: body.slug } });
    if (existing) return reply.status(409).send({ error: "Ya existe una categoria con ese slug" });
    if (body.parentCategoryId) {
      // findFirst acotado y no findUnique: una categoria padre de OTRO restaurante tiene que
      // leerse como inexistente, no como valida.
      const parent = await prisma.category.findFirst({ where: { id: body.parentCategoryId, restaurantId } });
      if (!parent) return reply.status(400).send({ error: "La categoria padre indicada no existe" });
    }
    const category = await prisma.category.create({ data: { ...body, restaurantId } });
    invalidateCatalogCache(restaurantId);
    return category;
  });

  app.patch("/api/categories/:id", async (request, reply) => {
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = categoryUpdateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);
    const category = await prisma.category.findFirst({ where: { id, restaurantId } });
    if (!category) return reply.status(404).send({ error: "Categoria no encontrada" });
    if (body.parentCategoryId) {
      if (body.parentCategoryId === id) {
        return reply.status(400).send({ error: "Una categoria no puede ser su propia categoria padre" });
      }
      const parent = await prisma.category.findFirst({ where: { id: body.parentCategoryId, restaurantId } });
      if (!parent) return reply.status(400).send({ error: "La categoria padre indicada no existe" });
    }

    const updated = await prisma.category.update({ where: { id }, data: body });
    invalidateCatalogCache(restaurantId);
    return updated;
  });

  app.delete("/api/categories/:id", async (request, reply) => {
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const restaurantId = await resolveRestaurantId(request);
    const category = await prisma.category.findFirst({ where: { id, restaurantId } });
    if (!category) return reply.status(404).send({ error: "Categoria no encontrada" });

    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      return reply
        .status(409)
        .send({ error: `Esta categoria tiene ${productCount} producto(s) asociado(s). Mueve o elimina esos productos primero.` });
    }
    const childCount = await prisma.category.count({ where: { parentCategoryId: id } });
    if (childCount > 0) {
      return reply
        .status(409)
        .send({ error: `Esta categoria tiene ${childCount} subcategoria(s). Mueve o elimina esas subcategorias primero.` });
    }

    await prisma.category.delete({ where: { id } });
    invalidateCatalogCache(restaurantId);
    return { ok: true };
  });

  app.post("/api/products", async (request, reply) => {
    requirePermission(request, "products");
    const body = productCreateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);
    // La categoria tiene que ser del mismo restaurante: si no, un categoryId ajeno colgaria
    // el producto del catalogo de otro negocio.
    const category = await prisma.category.findFirst({ where: { id: body.categoryId, restaurantId } });
    if (!category) return reply.status(400).send({ error: "La categoria indicada no existe" });
    const product = await prisma.product.create({ data: { ...body, restaurantId } });
    invalidateCatalogCache(restaurantId);
    return product;
  });

  app.patch("/api/products/:id", async (request, reply) => {
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = productUpdateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);

    const product = await prisma.product.findFirst({ where: { id, restaurantId } });
    if (!product) return reply.status(404).send({ error: "Producto no encontrado" });
    if (body.categoryId) {
      const category = await prisma.category.findFirst({ where: { id: body.categoryId, restaurantId } });
      if (!category) return reply.status(400).send({ error: "La categoria indicada no existe" });
    }

    const updated = await prisma.product.update({ where: { id }, data: body });
    invalidateCatalogCache(restaurantId);
    return updated;
  });

  app.delete("/api/products/:id", async (request, reply) => {
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const restaurantId = await resolveRestaurantId(request);
    const product = await prisma.product.findFirst({ where: { id, restaurantId } });
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

    invalidateCatalogCache(restaurantId);
    return { ok: true };
  });

  app.post("/api/promotions", async (request, reply) => {
    requirePermission(request, "promotions");
    const body = promotionCreateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);

    if (body.productId) {
      const product = await prisma.product.findFirst({ where: { id: body.productId, restaurantId } });
      if (!product) return reply.status(400).send({ error: "El producto de la promocion no existe" });
    }

    const promotion = await prisma.promotion.create({
      data: {
        ...body,
        restaurantId,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
    });
    invalidateCatalogCache(restaurantId);
    return promotion;
  });

  app.patch("/api/promotions/:id", async (request, reply) => {
    requirePermission(request, "promotions");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = promotionUpdateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);

    const promotion = await prisma.promotion.findFirst({ where: { id, restaurantId } });
    if (!promotion) return reply.status(404).send({ error: "Promocion no encontrada" });

    if (body.productId) {
      const product = await prisma.product.findFirst({ where: { id: body.productId, restaurantId } });
      if (!product) return reply.status(400).send({ error: "El producto de la promocion no existe" });
    }

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
    requirePermission(request, "promotions");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const promotion = await prisma.promotion.findFirst({
      where: { id, restaurantId: await resolveRestaurantId(request) },
    });
    if (!promotion) return reply.status(404).send({ error: "Promocion no encontrada" });

    await prisma.promotion.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Reglas de recomendacion (upsell/cross-sell), ver recommendationService.ts ----------

  app.get("/api/recommendations", async (request) => {
    requirePermission(request, "products");
    const rows = await prisma.productRecommendation.findMany({
      where: { restaurantId: await resolveRestaurantId(request) },
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
    requirePermission(request, "products");
    const body = recommendationCreateSchema.parse(request.body);
    const restaurantId = await resolveRestaurantId(request);
    if (body.recommendedProductId === body.sourceProductId) {
      return reply.status(400).send({ error: "El producto recomendado no puede ser el mismo que el de origen" });
    }
    // Origen y recomendado tienen que ser del restaurante del request: una regla cruzada
    // haria que el bot de un negocio ofreciera el producto de otro.
    const referencedProductIds = [body.sourceProductId, body.recommendedProductId].filter(
      (value): value is string => Boolean(value),
    );
    const ownProducts = await prisma.product.count({
      where: { id: { in: referencedProductIds }, restaurantId },
    });
    if (ownProducts !== new Set(referencedProductIds).size) {
      return reply.status(400).send({ error: "Uno o mas productos de la regla no existen" });
    }
    if (body.sourceCategoryId) {
      const category = await prisma.category.findFirst({ where: { id: body.sourceCategoryId, restaurantId } });
      if (!category) return reply.status(400).send({ error: "La categoria de origen no existe" });
    }

    const created = await prisma.productRecommendation.create({
      data: {
        restaurantId,
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
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = recommendationUpdateSchema.parse(request.body);
    const rule = await prisma.productRecommendation.findFirst({
      where: { id, restaurantId: await resolveRestaurantId(request) },
    });
    if (!rule) return reply.status(404).send({ error: "Regla de recomendacion no encontrada" });

    return prisma.productRecommendation.update({ where: { id }, data: body });
  });

  app.delete("/api/recommendations/:id", async (request, reply) => {
    requirePermission(request, "products");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const rule = await prisma.productRecommendation.findFirst({
      where: { id, restaurantId: await resolveRestaurantId(request) },
    });
    if (!rule) return reply.status(404).send({ error: "Regla de recomendacion no encontrada" });

    await prisma.productRecommendation.delete({ where: { id } });
    return { ok: true };
  });
}
