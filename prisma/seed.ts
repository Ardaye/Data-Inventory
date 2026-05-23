import { PrismaClient, ReservationStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [warehouseOne, warehouseTwo] = await Promise.all([
    prisma.warehouse.upsert({
      where: { code: "BLR-01" },
      update: {},
      create: {
        name: "Bengaluru Hub",
        code: "BLR-01",
      },
    }),
    prisma.warehouse.upsert({
      where: { code: "DEL-02" },
      update: {},
      create: {
        name: "Delhi Satellite",
        code: "DEL-02",
      },
    }),
  ]);

  const products = [
    {
      name: "Allo Runner Sneaker",
      sku: "ALL-001",
      description: "Lightweight running sneaker for D2C drops.",
      inventories: [
        { warehouseId: warehouseOne.id, totalUnits: 8 },
        { warehouseId: warehouseTwo.id, totalUnits: 4 },
      ],
    },
    {
      name: "Allo Travel Bottle",
      sku: "ALL-002",
      description: "Insulated bottle with a premium matte finish.",
      inventories: [
        { warehouseId: warehouseOne.id, totalUnits: 15 },
        { warehouseId: warehouseTwo.id, totalUnits: 7 },
      ],
    },
  ];

  for (const product of products) {
    const createdProduct = await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        name: product.name,
        description: product.description,
      },
      create: {
        name: product.name,
        sku: product.sku,
        description: product.description,
      },
    });

    for (const inventory of product.inventories) {
      await prisma.inventory.upsert({
        where: {
          productId_warehouseId: {
            productId: createdProduct.id,
            warehouseId: inventory.warehouseId,
          },
        },
        update: {
          totalUnits: inventory.totalUnits,
        },
        create: {
          productId: createdProduct.id,
          warehouseId: inventory.warehouseId,
          totalUnits: inventory.totalUnits,
        },
      });
    }
  }

  await prisma.reservation.deleteMany({
    where: { status: ReservationStatus.pending },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
