import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client/index";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient | null;
};

const databaseUrl = process.env.DATABASE_URL;

export const prisma =
  globalForPrisma.prisma ??
  (databaseUrl
    ? new PrismaClient({
        adapter: new PrismaPg({
          connectionString: databaseUrl,
        }),
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      })
    : null);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
