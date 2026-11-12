import { config } from "dotenv";
import { defineConfig } from "prisma/config";
config({ path: ".env.local", quiet: true });
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://ruang:ruang-local@127.0.0.1:55432/ruang_konten",
  },
});
