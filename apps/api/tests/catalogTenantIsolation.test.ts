import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Aislamiento del catalogo entre restaurantes (multi-tenant, fase 1).
//
// A diferencia del resto de la suite, este test NO mockea productService: la gracia es
// justamente ejercitar las queries reales acotadas por restaurantId, contra un prisma en
// memoria. Lo que se prueba es que el catalogo de un negocio sea invisible e intocable para
// otro, aunque el request traiga el id exacto de un producto ajeno.

interface FakeCategory {
  id: string;
  restaurantId: string;
  name: string;
  slug: string;
  sortOrder: number;
  parentCategoryId: string | null;
}

interface FakeProduct {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
  isDefaultVariant: boolean;
  searchKeywords: string | null;
  unitCount: number | null;
  isCombo: boolean;
  comboItems: unknown[];
  showInMenu: boolean;
}

const state: {
  restaurants: Array<{ id: string }>;
  categories: FakeCategory[];
  products: FakeProduct[];
  nextId: number;
} = { restaurants: [], categories: [], products: [], nextId: 1 };

/** Aplica un `where` plano de Prisma (solo igualdad, que es todo lo que usan estas rutas). */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

vi.mock("../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    platformRestaurant: {
      findUnique: vi.fn(async ({ where }: any) => state.restaurants.find((r) => r.id === where.id) ?? null),
    },
    category: {
      findMany: vi.fn(async ({ where, include }: any) => {
        const rows = state.categories.filter((c) => matches(c as any, where)).sort((a, b) => a.sortOrder - b.sortOrder);
        if (!include?.products) return rows;
        return rows.map((c) => ({
          ...c,
          products: state.products
            .filter((p) => p.categoryId === c.id && matches(p as any, include.products.where))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }));
      }),
      findFirst: vi.fn(async ({ where }: any) => state.categories.find((c) => matches(c as any, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => state.categories.find((c) => matches(c as any, where)) ?? null),
      count: vi.fn(async ({ where }: any) => state.categories.filter((c) => matches(c as any, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row: FakeCategory = {
          id: `cat-${state.nextId++}`,
          parentCategoryId: null,
          sortOrder: 0,
          ...data,
        };
        state.categories.push(row);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        state.categories = state.categories.filter((c) => c.id !== where.id);
        return { ok: true };
      }),
    },
    product: {
      findMany: vi.fn(async ({ where }: any) => state.products.filter((p) => matches(p as any, where))),
      findFirst: vi.fn(async ({ where }: any) => state.products.find((p) => matches(p as any, where)) ?? null),
      // Presente a proposito aunque las rutas ya no deban usarlo: si alguna vuelve a
      // findUnique (sin restaurantId), el mock devuelve el producto ajeno y el test falla
      // por la fuga real, no por un crash del mock.
      findUnique: vi.fn(async ({ where }: any) => state.products.find((p) => p.id === where.id) ?? null),
      count: vi.fn(async ({ where }: any) => state.products.filter((p) => matches(p as any, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row: FakeProduct = {
          id: `prod-${state.nextId++}`,
          description: null,
          isAvailable: true,
          sortOrder: 0,
          isDefaultVariant: false,
          searchKeywords: null,
          unitCount: null,
          isCombo: false,
          comboItems: [],
          showInMenu: true,
          ...data,
        };
        state.products.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.products.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        state.products = state.products.filter((p) => p.id !== where.id);
        return { ok: true };
      }),
    },
  },
}));

const { productRoutes } = await import("../src/routes/products.js");
const { invalidateCatalogCache } = await import("../src/modules/products/productService.js");

function buildTestApp() {
  const app = Fastify();
  app.register(productRoutes);
  return app;
}

/** Request del panel autenticado como ADMIN, opcionalmente marcado con un restaurante. */
function adminHeaders(restaurantId?: string): Record<string, string> {
  return {
    "x-admin-user-id": "u1",
    "x-admin-username": "admin",
    "x-admin-role": "ADMIN",
    "x-admin-permissions": "",
    ...(restaurantId ? { "x-restaurant-id": restaurantId } : {}),
  };
}

beforeEach(() => {
  state.restaurants = [{ id: "local-deployment" }, { id: "rest-b" }];
  state.categories = [
    { id: "cat-local", restaurantId: "local-deployment", name: "Bebidas", slug: "bebidas", sortOrder: 1, parentCategoryId: null },
    { id: "cat-b", restaurantId: "rest-b", name: "Bebidas", slug: "bebidas", sortOrder: 1, parentCategoryId: null },
  ];
  state.products = [
    {
      id: "prod-local",
      restaurantId: "local-deployment",
      categoryId: "cat-local",
      name: "Gaseosa del local",
      description: null,
      price: 4000,
      isAvailable: true,
      sortOrder: 1,
      isDefaultVariant: false,
      searchKeywords: null,
      unitCount: null,
      isCombo: false,
      comboItems: [],
      showInMenu: true,
    },
    {
      id: "prod-b",
      restaurantId: "rest-b",
      categoryId: "cat-b",
      name: "Jugo del restaurante B",
      description: null,
      price: 5000,
      isAvailable: true,
      sortOrder: 1,
      isDefaultVariant: false,
      searchKeywords: null,
      unitCount: null,
      isCombo: false,
      comboItems: [],
      showInMenu: true,
    },
  ];
  state.nextId = 1;
  invalidateCatalogCache();
});

describe("aislamiento del catalogo entre restaurantes", () => {
  it("cada restaurante ve solo sus productos, y sin header se asume el local", async () => {
    const app = buildTestApp();

    const localResponse = await app.inject({ method: "GET", url: "/api/products", headers: adminHeaders("local-deployment") });
    const bResponse = await app.inject({ method: "GET", url: "/api/products", headers: adminHeaders("rest-b") });
    const noHeaderResponse = await app.inject({ method: "GET", url: "/api/products", headers: adminHeaders() });

    const names = (raw: string) =>
      JSON.parse(raw).flatMap((c: any) => c.products.map((p: any) => p.name));

    expect(names(localResponse.body)).toEqual(["Gaseosa del local"]);
    expect(names(bResponse.body)).toEqual(["Jugo del restaurante B"]);
    // El bot y el panel de siempre no mandan header: tienen que seguir viendo el local.
    expect(names(noHeaderResponse.body)).toEqual(["Gaseosa del local"]);
  });

  it("no deja editar ni borrar un producto de otro restaurante aunque se sepa su id", async () => {
    const app = buildTestApp();

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/products/prod-local",
      headers: adminHeaders("rest-b"),
      payload: { price: 1 },
    });
    const del = await app.inject({ method: "DELETE", url: "/api/products/prod-local", headers: adminHeaders("rest-b") });

    expect(patch.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
    // El producto ajeno quedo intacto.
    expect(state.products.find((p) => p.id === "prod-local")).toMatchObject({ price: 4000 });
  });

  it("no deja crear un producto colgado de una categoria de otro restaurante", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: adminHeaders("rest-b"),
      payload: { categoryId: "cat-local", name: "Intruso", price: 1000 },
    });

    expect(response.statusCode).toBe(400);
    expect(state.products.some((p) => p.name === "Intruso")).toBe(false);
  });

  it("el producto creado queda atado al restaurante del request", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: adminHeaders("rest-b"),
      payload: { categoryId: "cat-b", name: "Limonada", price: 6000 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ restaurantId: "rest-b", categoryId: "cat-b" });
  });

  it("dos restaurantes pueden tener una categoria con el mismo slug", async () => {
    const app = buildTestApp();

    // "bebidas" ya existe en los dos, asi que repetirlo en el propio sigue siendo conflicto...
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/categories",
      headers: adminHeaders("rest-b"),
      payload: { name: "Bebidas", slug: "bebidas" },
    });
    expect(duplicate.statusCode).toBe(409);

    // ...pero un slug que solo existe en el OTRO restaurante tiene que poder crearse.
    state.categories.push({
      id: "cat-local-postres",
      restaurantId: "local-deployment",
      name: "Postres",
      slug: "postres",
      sortOrder: 2,
      parentCategoryId: null,
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/categories",
      headers: adminHeaders("rest-b"),
      payload: { name: "Postres", slug: "postres" },
    });

    expect(created.statusCode).toBe(200);
    expect(JSON.parse(created.body)).toMatchObject({ restaurantId: "rest-b", slug: "postres" });
  });

  it("rechaza un header que no corresponde a ningun restaurante", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/products",
      headers: adminHeaders("restaurante-que-no-existe"),
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).message).toContain("Restaurante no encontrado");
  });

  it("la cache del catalogo no le sirve a un restaurante lo de otro", async () => {
    const app = buildTestApp();

    // Se llena la cache con el catalogo del local...
    await app.inject({ method: "GET", url: "/api/products", headers: adminHeaders("local-deployment") });
    // ...y la siguiente lectura de otro restaurante no puede heredarla.
    const bResponse = await app.inject({ method: "GET", url: "/api/products", headers: adminHeaders("rest-b") });

    const names = JSON.parse(bResponse.body).flatMap((c: any) => c.products.map((p: any) => p.name));
    expect(names).toEqual(["Jugo del restaurante B"]);
  });
});
