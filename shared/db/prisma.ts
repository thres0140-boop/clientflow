import { PrismaClient } from "@/app/generated/prisma/client";

function makePrismaClient() {
  // In production on Vercel, use Neon's HTTP-based driver (PrismaNeonHTTP).
  // This avoids TCP cold-start timeouts — Neon free tier pauses after inactivity
  // and can take 10-20s to wake over TCP, which exceeds Vercel's 10s function limit.
  // HTTP queries fire instantly without a persistent connection.
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool, neonConfig } = require("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require("ws");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaNeon } = require("@prisma/adapter-neon");
    neonConfig.webSocketConstructor = ws;
    const connectionString = (process.env.STORAGE2_POSTGRES_PRISMA_URL || process.env.POSTGRES_PRISMA_URL)!;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }

  // Locally, use the standard client (SQLite via DATABASE_URL).
  return new PrismaClient();
}

type AnyPrismaClient = ReturnType<typeof makePrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AnyPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
