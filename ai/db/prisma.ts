// THE ONLY MODULE ALLOWED TO IMPORT THE AI PRODUCT'S GENERATED PRISMA CLIENT.
//
// Every /ai route and every ai/** server module gets its database access from here. The
// build-time boundary check (scripts/check-db-boundaries.mjs) fails the build if any other
// file imports app/generated/prisma-ai/client, or if any AI file imports the agency's
// shared/db/prisma. That is what keeps AI-business data out of the live agency database.
import { PrismaClient } from "@/app/generated/prisma-ai/client";

function makePrismaClient() {
  // Same Neon driver setup as the agency client — HTTP/WebSocket driver in production so a
  // paused Neon instance doesn't blow the function timeout on TCP wake-up.
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool, neonConfig } = require("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require("ws");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaNeon } = require("@prisma/adapter-neon");
    neonConfig.webSocketConstructor = ws;
    // Mirrors the agency wrapper: never throw at module load (`next build` evaluates route
    // modules without env); a missing URL surfaces on the first query instead.
    const connectionString = process.env.AI_POSTGRES_PRISMA_URL;
    if (!connectionString) console.error("[ai/db] AI_POSTGRES_PRISMA_URL is not set — every AI database query will fail");
    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return new PrismaClient();
}

type AnyPrismaClient = ReturnType<typeof makePrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prismaAi: AnyPrismaClient | undefined;
};

// Exported under the same name the copied routes already use (`prisma`); the isolation is
// the module path, enforced by the boundary check, not the identifier.
export const prisma = globalForPrisma.prismaAi ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaAi = prisma;
