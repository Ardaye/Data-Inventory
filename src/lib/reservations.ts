import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const RESERVATION_TTL_MS = 10 * 60 * 1000;

export class ReservationConflictError extends Error {}
export class ReservationGoneError extends Error {}

export type InventoryRow = {
  id: string;
  productId: string;
  warehouseId: string;
  totalUnits: number;
  reservedUnits: number;
};

export type ReservationRow = {
  id: string;
  inventoryId: string;
  quantity: number;
  status: string;
  expiresAt: Date;
};

export type ReservationDetails = Awaited<
  ReturnType<typeof getReservationDetails>
>;

async function getReservationDetails(
  reservationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.reservation.findUnique({
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
}

async function getInventoryByIdForUpdate(
  tx: Prisma.TransactionClient,
  inventoryId: string,
) {
  const rows = await tx.$queryRaw<InventoryRow[]>`
    SELECT "id", "productId", "warehouseId", "totalUnits", "reservedUnits"
    FROM "Inventory"
    WHERE "id" = ${inventoryId}
    FOR UPDATE
  `;

  return rows[0];
}

async function getReservationByIdForUpdate(
  tx: Prisma.TransactionClient,
  reservationId: string,
) {
  const rows = await tx.$queryRaw<ReservationRow[]>`
    SELECT "id", "inventoryId", "quantity", "status", "expiresAt"
    FROM "Reservation"
    WHERE "id" = ${reservationId}
    FOR UPDATE
  `;

  return rows[0];
}

async function getInventoryForUpdate(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
) {
  const rows = await tx.$queryRaw<InventoryRow[]>`
    SELECT "id", "productId", "warehouseId", "totalUnits", "reservedUnits"
    FROM "Inventory"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
    FOR UPDATE
  `;

  return rows[0];
}

export async function releaseExpiredReservations() {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<ReservationRow[]>`
      SELECT "id", "inventoryId", "quantity"
      FROM "Reservation"
      WHERE "status" = 'pending' AND "expiresAt" < ${now}
      ORDER BY "expiresAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
    `;

    for (const reservation of expired) {
      const inventory = await getInventoryByIdForUpdate(tx, reservation.inventoryId);

      if (!inventory) {
        continue;
      }

      await tx.$executeRaw`
        UPDATE "Reservation"
        SET "status" = 'released', "releasedAt" = ${now}
        WHERE "id" = ${reservation.id} AND "status" = 'pending'
      `;

      await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
        WHERE "id" = ${inventory.id}
      `;
    }
  });
}

export async function listProductsWithAvailability() {
  await releaseExpiredReservations();

  const products = await prisma.product.findMany({
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
  return prisma.warehouse.findMany({
    orderBy: {
      name: "asc",
    },
  });
}

export async function createReservation(productId: string, warehouseId: string, quantity: number) {
  return prisma.$transaction(async (tx) => {
    const inventory = await getInventoryForUpdate(tx, productId, warehouseId);

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

    await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedUnits" = "reservedUnits" + ${quantity}
      WHERE "id" = ${inventory.id}
    `;

    return reservation;
  });
}

export async function confirmReservation(reservationId: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await getReservationByIdForUpdate(tx, reservationId);

    if (!reservation) {
      throw new ReservationGoneError("Reservation not found");
    }

    if (reservation.status === "confirmed") {
      return getReservationDetails(reservationId, tx);
    }

    if (reservation.status === "released") {
      throw new ReservationGoneError("Reservation has been released");
    }

    if (reservation.expiresAt < new Date()) {
      const inventory = await getInventoryByIdForUpdate(tx, reservation.inventoryId);

      if (inventory) {
        await tx.$executeRaw`
          UPDATE "Reservation"
          SET "status" = 'released', "releasedAt" = ${new Date()}
          WHERE "id" = ${reservationId} AND "status" = 'pending'
        `;

        await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
          WHERE "id" = ${inventory.id}
        `;
      }

      throw new ReservationGoneError("Reservation has expired");
    }

    const inventory = await getInventoryByIdForUpdate(tx, reservation.inventoryId);

    if (!inventory) {
      throw new ReservationGoneError("Reservation inventory is no longer available");
    }

    await tx.$executeRaw`
      UPDATE "Reservation"
      SET "status" = 'confirmed', "confirmedAt" = ${new Date()}
      WHERE "id" = ${reservationId} AND "status" = 'pending'
    `;

    await tx.$executeRaw`
      UPDATE "Inventory"
      SET
        "totalUnits" = "totalUnits" - ${reservation.quantity},
        "reservedUnits" = "reservedUnits" - ${reservation.quantity}
      WHERE "id" = ${inventory.id}
    `;

    return getReservationDetails(reservationId, tx);
  });
}

export async function releaseReservation(reservationId: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await getReservationByIdForUpdate(tx, reservationId);

    if (!reservation) {
      throw new ReservationGoneError("Reservation not found");
    }

    if (reservation.status === "confirmed") {
      return getReservationDetails(reservationId, tx);
    }

    if (reservation.status === "released") {
      return getReservationDetails(reservationId, tx);
    }

    const inventory = await getInventoryByIdForUpdate(tx, reservation.inventoryId);

    if (!inventory) {
      throw new ReservationGoneError("Reservation inventory is no longer available");
    }

    await tx.$executeRaw`
      UPDATE "Reservation"
      SET "status" = 'released', "releasedAt" = ${new Date()}
      WHERE "id" = ${reservationId} AND "status" = 'pending'
    `;

    await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
      WHERE "id" = ${inventory.id}
    `;

    return getReservationDetails(reservationId, tx);
  });
}

export async function getReservationById(reservationId: string) {
  return getReservationDetails(reservationId);
}
