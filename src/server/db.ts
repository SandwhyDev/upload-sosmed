import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://ruang:ruang-local@127.0.0.1:55432/ruang_konten";
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 5 }),
  });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
