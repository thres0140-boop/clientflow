import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

function makePrismaClient() {
  // In production, use Neon's HTTP-based serverless driver.
  // This avoids TCP cold-start timeouts that plague the free tier when it pauses.
  if (process.env.NODE_ENV === "production") {
    const connectionString = process.env.POSTGRES_PRISMA_URL!;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }

  // Locally, use the standard TCP client (SQLite via DATABASE_URL, or Neon direct).
  return new PrismaClient();
}

type AnyPrismaClient = ReturnType<typeof makePrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AnyPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
