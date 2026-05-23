import { PrismaClient } from "@/app/generated/prisma/client";

function makePrismaClient() {
  const base = new PrismaClient();

  /**
   * Transparent retry extension — catches P1001 (Neon DB cold-start / paused)
   * and retries up to 5 times with increasing delays before giving up.
   * Neon free tier pauses after 5 min of inactivity and can take 10-20s to wake.
   */
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const MAX_RETRIES = 5;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              return await query(args);
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              if (code === "P1001" && attempt < MAX_RETRIES - 1) {
                // Give Neon more time to wake with each retry: 3s, 6s, 9s, 12s …
                await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
                continue;
              }
              throw err;
            }
          }
        },
      },
    },
  });
}

type PrismaWithRetry = ReturnType<typeof makePrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaWithRetry | undefined;
};

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
