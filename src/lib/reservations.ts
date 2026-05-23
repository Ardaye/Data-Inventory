import { prisma } from "./prisma";

const RESERVATION_TTL_MS = 10 * 60 * 1000;

export class ReservationConflictError extends Error {}
export class ReservationGoneError extends Error {}

type ProductRecord = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
};

type WarehouseRecord = {
  id: string;
  name: string;
  code: string;
};

type InventoryRecord = {
  id: string;
  productId: string;
  warehouseId: string;
  totalUnits: number;
  reservedUnits: number;
};

type ReservationRecord = {
  id: string;
  inventoryId: string;
  quantity: number;
  status: "pending" | "confirmed" | "released";
  expiresAt: Date;
  confirmedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ProductAvailability = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  warehouses: Array<{
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    totalUnits: number;
    reservedUnits: number;
    availableUnits: number;
  }>;
};

type ReservationDetails = {
  id: string;
  quantity: number;
  status: string;
  expiresAt: string;
  inventory: {
    product: {
      name: string;
      sku: string;
    };
    warehouse: {
      name: string;
      code: string;
    };
  };
};

const MEMORY_MODE = !process.env.DATABASE_URL;

const memoryProducts: ProductRecord[] = [
  {
    id: "prod-1",
    name: "Allo Runner Sneaker",
    sku: "ALL-001",
    description: "Lightweight running sneaker for D2C drops.",
  },
  {
    id: "prod-2",
    name: "Allo Travel Bottle",
    sku: "ALL-002",
    description: "Insulated bottle with a premium matte finish.",
  },
];

const memoryWarehouses: WarehouseRecord[] = [
  { id: "wh-1", name: "Bengaluru Hub", code: "BLR-01" },
  { id: "wh-2", name: "Delhi Satellite", code: "DEL-02" },
];

const memoryInventories: InventoryRecord[] = [
  { id: "inv-1", productId: "prod-1", warehouseId: "wh-1", totalUnits: 8, reservedUnits: 0 },
  { id: "inv-2", productId: "prod-1", warehouseId: "wh-2", totalUnits: 4, reservedUnits: 0 },
  { id: "inv-3", productId: "prod-2", warehouseId: "wh-1", totalUnits: 15, reservedUnits: 0 },
  { id: "inv-4", productId: "prod-2", warehouseId: "wh-2", totalUnits: 7, reservedUnits: 0 },
];

const memoryReservations: ReservationRecord[] = [];

function buildProductAvailability(): ProductAvailability[] {
  return memoryProducts.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    warehouses: memoryWarehouses.map((warehouse) => {
      const inventory = memoryInventories.find(
        (entry) => entry.productId === product.id && entry.warehouseId === warehouse.id,
      );

      if (!inventory) {
        return {
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          totalUnits: 0,
          reservedUnits: 0,
          availableUnits: 0,
        };
      }

      return {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        warehouseCode: warehouse.code,
        totalUnits: inventory.totalUnits,
        reservedUnits: inventory.reservedUnits,
        availableUnits: inventory.totalUnits - inventory.reservedUnits,
      };
    }),
  }));
}

function memoryReservationDetails(reservation: ReservationRecord): ReservationDetails {
  const inventory = memoryInventories.find((entry) => entry.id === reservation.inventoryId);
  const product = memoryProducts.find((entry) => entry.id === inventory?.productId);
  const warehouse = memoryWarehouses.find((entry) => entry.id === inventory?.warehouseId);

  if (!inventory || !product || !warehouse) {
    throw new Error("Reservation references missing inventory metadata");
  }

  return {
    id: reservation.id,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
    inventory: {
      product: {
        name: product.name,
        sku: product.sku,
      },
      warehouse: {
        name: warehouse.name,
        code: warehouse.code,
      },
    },
  };
}

function findMemoryInventory(productId: string, warehouseId: string) {
  return memoryInventories.find(
    (entry) => entry.productId === productId && entry.warehouseId === warehouseId,
  );
}

function releaseMemoryReservation(reservation: ReservationRecord, now = new Date()) {
  const inventory = memoryInventories.find((entry) => entry.id === reservation.inventoryId);

  if (!inventory) {
    return;
  }

  reservation.status = "released";
  reservation.releasedAt = now;
  reservation.updatedAt = now;
  inventory.reservedUnits = Math.max(0, inventory.reservedUnits - reservation.quantity);
}

async function releaseExpiredMemoryReservations() {
  const now = new Date();

  for (const reservation of memoryReservations) {
    if (reservation.status === "pending" && reservation.expiresAt < now) {
      releaseMemoryReservation(reservation, now);
    }
  }
}

async function memoryListProducts() {
  await releaseExpiredMemoryReservations();
  return buildProductAvailability();
}

export async function releaseExpiredReservations() {
  if (MEMORY_MODE) {
    await releaseExpiredMemoryReservations();
    return;
  }

  return prisma?.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<Array<{ id: string; inventoryId: string; quantity: number }>>`
      SELECT "id", "inventoryId", "quantity"
      FROM "Reservation"
      WHERE "status" = 'pending' AND "expiresAt" < NOW()
      ORDER BY "expiresAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
    `;

    for (const reservation of expired) {
      await tx.$executeRaw`
        UPDATE "Reservation"
        SET "status" = 'released', "releasedAt" = NOW()
        WHERE "id" = ${reservation.id} AND "status" = 'pending'
      `;

      await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
        WHERE "id" = ${reservation.inventoryId}
      `;
    }
  });
}

export async function listProductsWithAvailability() {
  if (MEMORY_MODE) {
    return memoryListProducts();
  }

  await releaseExpiredReservations();

  const products = await prisma?.product.findMany({
    include: {
      inventories: {
        include: {
          warehouse: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  if (!products) {
    return [];
  }

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    warehouses: product.inventories.map((inventory) => ({
      warehouseId: inventory.warehouseId,
      warehouseName: inventory.warehouse.name,
      warehouseCode: inventory.warehouse.code,
      totalUnits: inventory.totalUnits,
      reservedUnits: inventory.reservedUnits,
      availableUnits: inventory.totalUnits - inventory.reservedUnits,
    })),
  }));
}

export async function listWarehouses() {
  if (MEMORY_MODE) {
    return memoryWarehouses;
  }

  return prisma?.warehouse.findMany({
    orderBy: {
      name: "asc",
    },
  }) ?? [];
}

export async function createReservation(productId: string, warehouseId: string, quantity: number) {
  if (MEMORY_MODE) {
    await releaseExpiredMemoryReservations();

    const inventory = findMemoryInventory(productId, warehouseId);

    if (!inventory) {
      throw new ReservationConflictError("Inventory not found");
    }

    const available = inventory.totalUnits - inventory.reservedUnits;

    if (available < quantity) {
      throw new ReservationConflictError("Not enough stock available");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    const reservation: ReservationRecord = {
      id: `res-${memoryReservations.length + 1}`,
      inventoryId: inventory.id,
      quantity,
      status: "pending",
      expiresAt,
      confirmedAt: null,
      releasedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    memoryReservations.push(reservation);
    inventory.reservedUnits += quantity;

    return memoryReservationDetails(reservation);
  }

  if (!prisma) {
    throw new ReservationConflictError("Database is not configured");
  }

  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findFirst({
      where: {
        productId,
        warehouseId,
      },
    });

    if (!inventory) {
      throw new ReservationConflictError("Inventory not found");
    }

    const available = inventory.totalUnits - inventory.reservedUnits;

    if (available < quantity) {
      throw new ReservationConflictError("Not enough stock available");
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

    const reservation = await tx.reservation.create({
      data: {
        inventoryId: inventory.id,
        quantity,
        status: "pending",
        expiresAt,
      },
      include: {
        inventory: {
          include: {
            product: true,
            warehouse: true,
          },
        },
      },
    });

    await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        reservedUnits: inventory.reservedUnits + quantity,
      },
    });

    return {
      id: reservation.id,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
      inventory: {
        product: {
          name: reservation.inventory.product.name,
          sku: reservation.inventory.product.sku,
        },
        warehouse: {
          name: reservation.inventory.warehouse.name,
          code: reservation.inventory.warehouse.code,
        },
      },
    };
  });
}

export async function confirmReservation(reservationId: string) {
  if (MEMORY_MODE) {
    await releaseExpiredMemoryReservations();

    const reservation = memoryReservations.find((item) => item.id === reservationId);

    if (!reservation) {
      throw new ReservationGoneError("Reservation not found");
    }

    if (reservation.status === "confirmed") {
      return memoryReservationDetails(reservation);
    }

    if (reservation.status === "released") {
      throw new ReservationGoneError("Reservation has been released");
    }

    if (reservation.expiresAt < new Date()) {
      releaseMemoryReservation(reservation);
      throw new ReservationGoneError("Reservation has expired");
    }

    const inventory = memoryInventories.find((item) => item.id === reservation.inventoryId);

    if (!inventory) {
      throw new ReservationGoneError("Reservation inventory is no longer available");
    }

    inventory.totalUnits = Math.max(0, inventory.totalUnits - reservation.quantity);
    inventory.reservedUnits = Math.max(0, inventory.reservedUnits - reservation.quantity);
    reservation.status = "confirmed";
    reservation.confirmedAt = new Date();
    reservation.updatedAt = reservation.confirmedAt;

    return memoryReservationDetails(reservation);
  }

  if (!prisma) {
    throw new ReservationGoneError("Database is not configured");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      inventory: true,
    },
  });

  if (!reservation) {
    throw new ReservationGoneError("Reservation not found");
  }

  if (reservation.status === "confirmed") {
    return {
      id: reservation.id,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
      inventory: {
        product: {
          name: "",
          sku: "",
        },
        warehouse: {
          name: "",
          code: "",
        },
      },
    };
  }

  if (reservation.status === "released") {
    throw new ReservationGoneError("Reservation has been released");
  }

  if (reservation.expiresAt < new Date()) {
    throw new ReservationGoneError("Reservation has expired");
  }

  const updatedReservation = await prisma.$transaction(async (tx) => {
    const currentInventory = await tx.inventory.findUnique({
      where: { id: reservation.inventoryId },
    });

    if (!currentInventory) {
      throw new ReservationGoneError("Reservation inventory is no longer available");
    }

    const confirmed = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: "confirmed",
        confirmedAt: new Date(),
      },
    });

    await tx.inventory.update({
      where: { id: reservation.inventoryId },
      data: {
        totalUnits: currentInventory.totalUnits - reservation.quantity,
        reservedUnits: currentInventory.reservedUnits - reservation.quantity,
      },
    });

    return confirmed;
  });

  return {
    id: updatedReservation.id,
    quantity: updatedReservation.quantity,
    status: updatedReservation.status,
    expiresAt: updatedReservation.expiresAt.toISOString(),
    inventory: {
      product: {
        name: "",
        sku: "",
      },
      warehouse: {
        name: "",
        code: "",
      },
    },
  };
}

export async function releaseReservation(reservationId: string) {
  if (MEMORY_MODE) {
    await releaseExpiredMemoryReservations();

    const reservation = memoryReservations.find((item) => item.id === reservationId);

    if (!reservation) {
      throw new ReservationGoneError("Reservation not found");
    }

    if (reservation.status === "confirmed") {
      return memoryReservationDetails(reservation);
    }

    if (reservation.status === "released") {
      return memoryReservationDetails(reservation);
    }

    releaseMemoryReservation(reservation);

    return memoryReservationDetails(reservation);
  }

  if (!prisma) {
    throw new ReservationGoneError("Database is not configured");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });

  if (!reservation) {
    throw new ReservationGoneError("Reservation not found");
  }

  if (reservation.status === "confirmed") {
    return {
      id: reservation.id,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
      inventory: {
        product: {
          name: "",
          sku: "",
        },
        warehouse: {
          name: "",
          code: "",
        },
      },
    };
  }

  if (reservation.status === "released") {
    return {
      id: reservation.id,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
      inventory: {
        product: {
          name: "",
          sku: "",
        },
        warehouse: {
          name: "",
          code: "",
        },
      },
    };
  }

  const updatedReservation = await prisma.$transaction(async (tx) => {
    const currentInventory = await tx.inventory.findUnique({
      where: { id: reservation.inventoryId },
    });

    if (!currentInventory) {
      throw new ReservationGoneError("Reservation inventory is no longer available");
    }

    const released = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: "released",
        releasedAt: new Date(),
      },
    });

    await tx.inventory.update({
      where: { id: reservation.inventoryId },
      data: {
        reservedUnits: currentInventory.reservedUnits - reservation.quantity,
      },
    });

    return released;
  });

  return {
    id: updatedReservation.id,
    quantity: updatedReservation.quantity,
    status: updatedReservation.status,
    expiresAt: updatedReservation.expiresAt.toISOString(),
    inventory: {
      product: {
        name: "",
        sku: "",
      },
      warehouse: {
        name: "",
        code: "",
      },
    },
  };
}

export async function getReservationById(reservationId: string) {
  if (MEMORY_MODE) {
    await releaseExpiredMemoryReservations();
    const reservation = memoryReservations.find((item) => item.id === reservationId);

    if (!reservation) {
      return null;
    }

    return memoryReservationDetails(reservation);
  }

  if (!prisma) {
    return null;
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      inventory: {
        include: {
          product: true,
          warehouse: true,
        },
      },
    },
  });

  if (!reservation) {
    return null;
  }

  return {
    id: reservation.id,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
    inventory: {
      product: {
        name: reservation.inventory.product.name,
        sku: reservation.inventory.product.sku,
      },
      warehouse: {
        name: reservation.inventory.warehouse.name,
        code: reservation.inventory.warehouse.code,
      },
    },
  };
}
