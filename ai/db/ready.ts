import { prisma } from "@/ai/db/prisma";

// True once the AI database has had prisma-ai/init.sql applied (checked via the Client table).
// Lets scheduled crons no-op with a 200 instead of crashing between "database provisioned" and
// "schema applied" (POST /ai/api/admin/migrate). Cached per function instance; a negative answer
// is re-checked every call so the first run after applying the schema goes through.
let ready = false;
export async function aiSchemaReady(): Promise<boolean> {
  if (ready) return true;
  try {
    const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('"Client"') IS NOT NULL AS ok`);
    ready = !!rows[0]?.ok;
  } catch {
    ready = false;
  }
  return ready;
}
