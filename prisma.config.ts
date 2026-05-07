import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrate: {
    async database() {
      return {
        url: process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "",
      };
    },
  },
});
