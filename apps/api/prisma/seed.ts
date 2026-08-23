import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.businessSettings.deleteMany();
  await prisma.businessSettings.create({
    data: {
      restaurantName: "Pollos El Corralito",
      phone: "+57 300 000 0000",
      address: "Cra 10 # 20-30, Bogota",
      currency: "COP",
      timezone: "America/Bogota",
      openingHours: {
        mon: { open: "11:00", close: "22:00" },
        tue: { open: "11:00", close: "22:00" },
        wed: { open: "11:00", close: "22:00" },
        thu: { open: "11:00", close: "22:00" },
        fri: { open: "11:00", close: "22:00" },
        sat: { open: "11:00", close: "22:00" },
        sun: { open: "11:00", close: "22:00" },
      },
      deliveryFee: 5000,
      estimatedPrepMinutes: 35,
      acceptsScheduledOrders: true,
      reactivationEnabled: false,
      reactivationTemplateName: "",
      reactivationTemplateLanguage: "es_CO",
      reactivationDormantDays: 30,
      reactivationCooldownDays: 30,
      outOfHoursMessage:
        "Gracias por escribirnos. Nuestro horario de atencion es de 11:00 a. m. a 10:00 p. m., todos los dias. Puedes dejar tu pedido y lo procesamos apenas abramos.",
      welcomeMessage:
        "¡Hola! Bienvenido a Pollos El Corralito 🍗 ¿En que te ayudo hoy?\n\n1. Ver el menu\n2. Hacer un pedido\n3. Promociones\n4. Estado de un pedido\n\nEscribeme libremente, con gusto te ayudo.",
    },
  });

  const friedChicken = await prisma.category.create({ data: { name: "Pollo Frito", slug: "pollo-frito", sortOrder: 1 } });
  const grilledChicken = await prisma.category.create({ data: { name: "Pollo Asado", slug: "pollo-asado", sortOrder: 2 } });
  const combos = await prisma.category.create({ data: { name: "Combos", slug: "combos", sortOrder: 3 } });
  const sides = await prisma.category.create({ data: { name: "Acompanantes", slug: "acompanantes", sortOrder: 4 } });
  const drinks = await prisma.category.create({ data: { name: "Bebidas", slug: "bebidas", sortOrder: 5 } });

  await prisma.product.createMany({
    data: [
      { categoryId: friedChicken.id, name: "Pollo Frito 4 piezas", price: 28000, sortOrder: 1 },
      { categoryId: friedChicken.id, name: "Pollo Frito 8 piezas", price: 52000, sortOrder: 2 },
      { categoryId: friedChicken.id, name: "Pollo Frito 12 piezas", price: 74000, sortOrder: 3 },

      { categoryId: grilledChicken.id, name: "Pollo Asado Entero", price: 48000, sortOrder: 1 },
      { categoryId: grilledChicken.id, name: "Pollo Asado Medio", price: 27000, sortOrder: 2 },

      {
        categoryId: combos.id,
        name: "Combo Familiar (pollo 8 piezas + papas + gaseosa 1.5L)",
        description: "8 piezas de pollo frito o asado, papas familiares y gaseosa de 1.5 litros",
        price: 68000,
        sortOrder: 1,
      },
      {
        categoryId: combos.id,
        name: "Combo Pareja (pollo 4 piezas + papas + 2 gaseosas personales)",
        description: "4 piezas de pollo frito o asado, papas y dos gaseosas personales",
        price: 42000,
        sortOrder: 2,
      },

      { categoryId: sides.id, name: "Papas Francesas", price: 9000, sortOrder: 1 },
      { categoryId: sides.id, name: "Arepa", price: 4000, sortOrder: 2 },
      { categoryId: sides.id, name: "Ensalada", price: 6000, sortOrder: 3 },
      { categoryId: sides.id, name: "Papa Salada", price: 8000, sortOrder: 4 },

      { categoryId: drinks.id, name: "Gaseosa Personal", price: 5000, sortOrder: 1 },
      { categoryId: drinks.id, name: "Gaseosa 1.5L", price: 9000, sortOrder: 2 },
      { categoryId: drinks.id, name: "Jugo Natural", price: 6500, sortOrder: 3 },
    ],
  });

  await prisma.promotion.createMany({
    data: [
      {
        title: "Miercoles de Combo",
        description: "10% de descuento en el Combo Familiar todos los miercoles",
        isActive: true,
      },
      {
        title: "2x1 en Gaseosa Personal",
        description: "Llevando cualquier combo, la segunda gaseosa personal es gratis",
        isActive: true,
      },
    ],
  });

  console.log("Seed completado: Pollos El Corralito");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
