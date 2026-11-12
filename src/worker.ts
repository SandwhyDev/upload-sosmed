import { PgBoss } from "pg-boss";
import { db, databaseUrl } from "./server/db";
import { publishToPlatform, ProviderError } from "./server/providers";
import type { Platform, Snapshot } from "./lib/domain";
import type { Prisma } from "./generated/prisma/client";
import pg from "pg";

const lockClient = new pg.Client({ connectionString: databaseUrl });
await lockClient.connect();
const lock = await lockClient.query(
  "SELECT pg_try_advisory_lock(782366) AS acquired",
);
if (!lock.rows[0].acquired) {
  await lockClient.end();
  throw new Error(
    "Worker lain sudah aktif. Jalankan satu worker per database.",
  );
}
const boss = new PgBoss(databaseUrl),
  queue = "publish-content";
boss.on("error", () => console.error("Antrean database mengalami gangguan."));
await boss.start();
await boss.createQueue(queue, { retryLimit: 0, expireInSeconds: 1800 });
// A process interruption can happen after a provider accepted a write. Never replay these blindly.
await db.publicationJob.updateMany({
  where: { state: { in: ["UPLOADING", "PROCESSING"] } },
  data: {
    state: "NEEDS_CHECK",
    message:
      "Worker sebelumnya berhenti saat proses berjalan. Periksa platform sebelum publikasi ulang.",
  },
});
await boss.work<{ jobId: string }>(queue, { batchSize: 1 }, async (jobs) => {
  for (const queued of jobs) {
    const pending = await db.publicationJob.findUnique({
      where: { id: queued.data.jobId },
    });
    if (!pending) continue;
    const claimed = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT platform FROM "Account" WHERE platform = ${pending.platform} FOR UPDATE`;
      return tx.publicationJob.updateMany({
        where: {
          id: pending.id,
          state: "QUEUED",
          availableAt: { lte: new Date() },
        },
        data: {
          state: "UPLOADING",
          message: "Menyiapkan publikasi",
          attempts: { increment: 1 },
        },
      });
    });
    if (!claimed.count) continue;
    const job = await db.publicationJob.findUniqueOrThrow({
      where: { id: queued.data.jobId },
    });
    try {
      const account = await db.account.findUnique({
        where: { platform: job.platform },
      });
      if (
        !account ||
        account.status !== "CONNECTED" ||
        account.externalId !== job.externalAccountId
      )
        throw new ProviderError("Akun tujuan berubah atau koneksi tidak siap.");
      const result = await publishToPlatform(
        job.platform as Platform,
        account,
        job.snapshot as unknown as Snapshot,
        {
          checkpoint: async (value, message, externalId) => {
            await db.publicationJob.update({
              where: { id: job.id },
              data: {
                checkpoint: JSON.parse(
                  JSON.stringify(value),
                ) as Prisma.InputJsonValue,
                message,
                ...(externalId ? { externalId } : {}),
              },
            });
          },
          processing: async (message) => {
            await db.publicationJob.update({
              where: { id: job.id },
              data: { state: "PROCESSING", message },
            });
          },
        },
      );
      await db.publicationJob.update({
        where: { id: job.id },
        data: {
          state: "SUCCEEDED",
          externalId: result.id,
          externalUrl: result.url ?? null,
          message: result.message,
        },
      });
    } catch (error) {
      const current = await db.publicationJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      const uncertain =
        Boolean(current.externalId) ||
        (error instanceof ProviderError ? error.uncertain : true);
      const retry =
        !uncertain &&
        error instanceof ProviderError &&
        error.retryable &&
        job.attempts < 3;
      await db.publicationJob.update({
        where: { id: job.id },
        data: {
          state: uncertain ? "NEEDS_CHECK" : retry ? "QUEUED" : "FAILED",
          availableAt: new Date(Date.now() + job.attempts * 30000),
          message:
            error instanceof ProviderError
              ? error.message
              : "Proses terhenti. Periksa hasil platform sebelum mencoba ulang.",
        },
      });
    }
  }
});
let dispatching = false;
async function tick() {
  if (dispatching) return;
  dispatching = true;
  try {
    await db.workerHeartbeat.upsert({
      where: { id: "publisher" },
      create: { id: "publisher" },
      update: { updatedAt: new Date() },
    });
    const jobs = await db.publicationJob.findMany({
      where: { state: "QUEUED", availableAt: { lte: new Date() } },
      take: 20,
      orderBy: { createdAt: "asc" },
    });
    for (const job of jobs)
      await boss.send(
        queue,
        { jobId: job.id },
        { singletonKey: job.id, singletonSeconds: 15 },
      );
  } catch {
    console.error("Worker belum dapat menghubungi database.");
  } finally {
    dispatching = false;
  }
}
await tick();
const timer = setInterval(tick, 5000);
console.log(
  "Worker publikasi siap. Tidak ada konten yang dikirim tanpa konfirmasi aplikasi.",
);
async function stop() {
  clearInterval(timer);
  await boss.stop({ graceful: true, timeout: 10000 });
  await db.$disconnect();
  await lockClient.end();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
