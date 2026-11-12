import { z } from "zod";
import { unlink } from "node:fs/promises";
import { db } from "./db";
import {
  AppError,
  assertLocalRequest,
  encryptToken,
  readJson,
} from "./security";
import {
  hasRemoteStorage,
  remoteStorageName,
  mediaPath,
  uploadMedia,
} from "./media";
import { checkAccount, ProviderError } from "./providers";
import { discoverMetaAccounts, publicMetaChoices } from "./meta-accounts";
import {
  finishYoutubeOAuth,
  startYoutubeOAuth,
  youtubeOAuth,
} from "./youtube-oauth";
import {
  finishInstagramOAuth,
  instagramOAuth,
  startInstagramOAuth,
} from "./instagram-oauth";
import {
  finishLinkedInOAuth,
  linkedinOAuth,
  startLinkedInOAuth,
} from "./linkedin-oauth";
import {
  draftSchema,
  platforms,
  validateContent,
  type AccountInfo,
  type Platform,
  type Snapshot,
} from "../lib/domain";
import type { Prisma, Account } from "../generated/prisma/client";
const jsonValue = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const accountView = (account: Account) => ({
  platform: account.platform,
  label: account.label,
  externalId: account.externalId,
  loginType: account.loginType,
  status: account.status,
  message: account.message,
  checkedAt: account.checkedAt?.toISOString() ?? null,
  updatedAt: account.updatedAt.toISOString(),
  hasToken: true,
});
const uuid = z.string().uuid();
const platformSchema = z.enum(platforms);
const accountSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    externalId: z.string().trim().min(1).max(100),
    token: z.string().trim().max(5000).optional(),
    loginType: z.enum(["facebook", "instagram"]).default("facebook"),
  })
  .strict();
const metaTokenSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(10, "Masukkan access token yang valid.")
      .max(5000),
  })
  .strict();
const metaConnectSchema = metaTokenSchema.extend({
  externalId: z.string().regex(/^\d+$/),
});

async function saveAccount(
  platform: Platform,
  input: Omit<z.infer<typeof accountSchema>, "loginType"> & {
    loginType: "facebook" | "instagram" | "google" | "linkedin";
  },
  verified = false,
  expectedUpdatedAt?: number | null,
) {
  const encrypted = input.token ? await encryptToken(input.token) : null;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT platform FROM "Account" WHERE platform = ${platform} FOR UPDATE`;
    const old = await tx.account.findUnique({ where: { platform } });
    if (
      expectedUpdatedAt !== undefined &&
      (old?.updatedAt.getTime() ?? null) !== expectedUpdatedAt
    )
      throw new AppError(
        "Koneksi akun berubah selama otorisasi. Hubungkan kembali.",
        409,
      );
    if (!encrypted && !old) throw new AppError("Masukkan access token.");
    if (!encrypted && ["google", "linkedin"].includes(old?.loginType || ""))
      throw new AppError(
        "Masukkan access token untuk beralih ke koneksi manual.",
      );
    const active = await tx.publicationJob.count({
      where: { platform, state: { in: ["QUEUED", "UPLOADING", "PROCESSING"] } },
    });
    if (active)
      throw new AppError(
        "Tunggu pekerjaan aktif selesai sebelum mengganti akun atau token.",
        409,
      );
    const data = {
      label: input.label,
      externalId: input.externalId,
      loginType: input.loginType,
      secret: encrypted || old!.secret,
      status: verified ? "CONNECTED" : "UNVERIFIED",
      message: verified
        ? "Identitas akun terverifikasi. Izin publikasi diperiksa platform saat publish."
        : "Tersimpan. Jalankan cek koneksi.",
      checkedAt: verified ? new Date() : null,
    };
    if (expectedUpdatedAt === null)
      return tx.account.create({ data: { platform, ...data } });
    return tx.account.upsert({
      where: { platform },
      create: { platform, ...data },
      update: data,
    });
  });
}

export async function handleApi(request: Request, segments: string[]) {
  try {
    const [resource, id, action] = segments,
      method = request.method;
    const oauthPlatform =
      resource === "accounts" &&
      segments.length === 3 &&
      (id === "youtube" || id === "instagram" || id === "linkedin")
        ? id
        : null;
    const oauthCallback =
      oauthPlatform !== null && action === "callback" && method === "GET";
    assertLocalRequest(request, oauthCallback);
    if (oauthPlatform && action === "oauth" && method === "POST") {
      const current = await db.account.findUnique({
        where: { platform: oauthPlatform },
        select: { updatedAt: true },
      });
      const updatedAt = current?.updatedAt.getTime() ?? null;
      if (oauthPlatform === "instagram")
        return startInstagramOAuth(request, updatedAt);
      if (oauthPlatform === "linkedin")
        return startLinkedInOAuth(
          request,
          await readJson(request, 4096),
          updatedAt,
        );
      return startYoutubeOAuth(
        request,
        await readJson(request, 4096),
        updatedAt,
      );
    }
    if (oauthPlatform && oauthCallback) {
      const flow =
        oauthPlatform === "youtube"
          ? youtubeOAuth
          : oauthPlatform === "linkedin"
            ? linkedinOAuth
            : instagramOAuth;
      const entry = flow.take(request);
      if (!entry)
        return flow.result(
          "Sesi koneksi tidak cocok atau kedaluwarsa. Mulai kembali dari Akun terhubung.",
          false,
          false,
        );
      const query = new URL(request.url).searchParams;
      if (query.has("error"))
        return flow.result(
          "Izin belum diberikan. Anda dapat menghubungkan kembali akun.",
          false,
          true,
        );
      const code = query.get("code");
      if (!code || code.length > 4096 || query.getAll("code").length !== 1)
        return flow.result(
          "Kode otorisasi tidak valid. Hubungkan kembali akun.",
          false,
          true,
        );
      try {
        const selected =
          "appId" in entry.data
            ? await finishInstagramOAuth(entry.data, code)
            : "verifier" in entry.data
              ? await finishYoutubeOAuth(entry.data, code)
              : await finishLinkedInOAuth(entry.data, code);
        await saveAccount(
          oauthPlatform,
          selected,
          true,
          entry.expectedUpdatedAt,
        );
        return flow.result(
          oauthPlatform === "instagram"
            ? "Akun Instagram terhubung dan identitas terverifikasi."
            : oauthPlatform === "linkedin"
              ? "Profil LinkedIn terhubung dan identitas terverifikasi."
              : "Kanal YouTube terhubung dan identitas terverifikasi.",
          true,
          true,
        );
      } catch (error) {
        return flow.result(
          error instanceof AppError
            ? error.message
            : "Koneksi belum dapat disimpan. Coba hubungkan kembali.",
          false,
          true,
        );
      }
    }
    if (resource === "state" && method === "GET") {
      const [drafts, media, accounts, batches, heartbeat] = await Promise.all([
        db.draft.findMany({
          include: { media: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
        db.media.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
        db.account.findMany(),
        db.batch.findMany({
          include: { jobs: { orderBy: { createdAt: "asc" } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        db.workerHeartbeat.findUnique({ where: { id: "publisher" } }),
      ]);
      return Response.json({
        drafts,
        media,
        accounts: accounts.map(accountView),
        batches: batches.map((batch) => ({
          ...batch,
          jobs: batch.jobs.map(
            ({
              id,
              platform,
              state,
              message,
              externalId,
              externalUrl,
              accountLabel,
              attempts,
              updatedAt,
            }) => ({
              id,
              platform,
              state,
              message,
              externalId,
              externalUrl,
              accountLabel,
              attempts,
              updatedAt,
            }),
          ),
        })),
        workerOnline: Boolean(
          heartbeat && Date.now() - heartbeat.updatedAt.getTime() < 30000,
        ),
        storage: remoteStorageName() ?? "Penyimpanan lokal",
      });
    }
    if (resource === "media" && method === "POST" && !id)
      return Response.json(await uploadMedia(request), { status: 201 });
    if (resource === "media" && method === "DELETE" && id) {
      uuid.parse(id);
      const [references, jobs] = await Promise.all([
        db.draft.count({ where: { mediaId: id } }),
        db.publicationJob.count({
          where: { snapshot: { path: ["mediaId"], equals: id } },
        }),
      ]);
      if (references || jobs)
        throw new AppError(
          "Media masih digunakan oleh draft atau riwayat publikasi.",
          409,
        );
      const removed = await db.media.deleteMany({ where: { id } });
      if (!removed.count) throw new AppError("Media tidak ditemukan.", 404);
      await unlink(mediaPath(id)).catch(() => {});
      return Response.json({ ok: true });
    }
    if (resource === "drafts" && method === "POST" && !id) {
      const data = draftSchema.parse(await readJson(request));
      if (
        data.mediaId &&
        !(await db.media.findUnique({ where: { id: data.mediaId } }))
      )
        throw new AppError("Media tidak ditemukan.");
      return Response.json(
        await db.draft.create({
          data: {
            ...data,
            variants: jsonValue(data.variants),
            youtube: jsonValue(data.youtube),
          },
          include: { media: true },
        }),
        { status: 201 },
      );
    }
    if (resource === "drafts" && method === "PUT" && id) {
      uuid.parse(id);
      const body = z
        .object({
          expectedVersion: z.number().int().positive(),
          draft: draftSchema,
        })
        .strict()
        .parse(await readJson(request));
      if (
        body.draft.mediaId &&
        !(await db.media.findUnique({ where: { id: body.draft.mediaId } }))
      )
        throw new AppError("Media tidak ditemukan.");
      const draft = await db.$transaction(async (tx) => {
        const result = await tx.draft.updateMany({
          where: { id, version: body.expectedVersion },
          data: {
            ...body.draft,
            variants: jsonValue(body.draft.variants),
            youtube: jsonValue(body.draft.youtube),
            version: { increment: 1 },
          },
        });
        if (!result.count)
          throw new AppError(
            "Draft telah berubah. Buka ulang sebelum menyimpan.",
            409,
          );
        return tx.draft.findUniqueOrThrow({
          where: { id },
          include: { media: true },
        });
      });
      return Response.json(draft);
    }
    if (resource === "drafts" && method === "DELETE" && id) {
      uuid.parse(id);
      if (await db.batch.count({ where: { draftId: id } }))
        throw new AppError(
          "Konten dengan riwayat publikasi tidak dapat dihapus. Buat duplikat untuk revisi.",
          409,
        );
      await db.draft.deleteMany({ where: { id } });
      return Response.json({ ok: true });
    }
    if (resource === "review" && method === "POST") {
      const body = z
        .object({ draftId: uuid, version: z.number().int().positive() })
        .strict()
        .parse(await readJson(request));
      const draft = await db.draft.findUnique({
        where: { id: body.draftId },
        include: { media: true },
      });
      if (!draft) throw new AppError("Draft tidak ditemukan.", 404);
      if (draft.version !== body.version)
        throw new AppError(
          "Versi draft sudah berubah. Simpan dan review kembali.",
          409,
        );
      const input = draftSchema.parse({
        title: draft.title,
        caption: draft.caption,
        platforms: draft.platforms,
        variants: draft.variants,
        youtube: draft.youtube,
        mediaId: draft.mediaId,
      });
      if (!input.platforms.length)
        throw new AppError("Pilih setidaknya satu platform.");
      const accounts = await db.account.findMany({
        where: { platform: { in: input.platforms } },
      });
      const issues = validateContent(
        input,
        draft.media,
        accounts.map(accountView) as AccountInfo[],
        hasRemoteStorage(),
      );
      const priorJobs = await db.publicationJob.findMany({
        where: {
          batch: { draftId: draft.id },
          platform: { in: input.platforms },
          state: { in: ["SUCCEEDED", "NEEDS_CHECK"] },
        },
        select: { platform: true, state: true },
        take: 100,
      });
      for (const platform of input.platforms) {
        const prior = priorJobs.filter((job) => job.platform === platform);
        if (prior.some((job) => job.state === "NEEDS_CHECK"))
          issues.push({
            platform,
            severity: "warning",
            message:
              "Hasil publikasi sebelumnya belum pasti. Periksa akun tujuan sebelum melanjutkan; publikasi baru bisa membuat posting ganda.",
          });
        else if (prior.length)
          issues.push({
            platform,
            severity: "warning",
            message:
              "Konten ini pernah diterbitkan ke platform ini. Konfirmasi berikut akan membuat posting baru.",
          });
      }
      if (issues.some((i) => i.severity === "error"))
        return Response.json({ reviewId: null, issues, snapshot: null });
      const snapshot: Snapshot = {
        ...input,
        media: draft.media,
        warnings: issues.filter((issue) => issue.severity === "warning"),
        accounts: accounts.map((a) => ({
          platform: a.platform as Platform,
          externalId: a.externalId,
          label: a.label,
          loginType: a.loginType,
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
      const review = await db.review.create({
        data: {
          draftId: draft.id,
          version: draft.version,
          snapshot: jsonValue(snapshot),
        },
      });
      return Response.json({ reviewId: review.id, issues, snapshot });
    }
    if (resource === "publish" && method === "POST") {
      const { reviewId, acknowledgedWarnings } = z
        .object({ reviewId: uuid, acknowledgedWarnings: z.boolean() })
        .strict()
        .parse(await readJson(request));
      const existing = await db.batch.findUnique({
        where: { reviewId },
        include: { jobs: true },
      });
      if (existing) return Response.json({ id: existing.id });
      const review = await db.review.findUnique({
        where: { id: reviewId },
        include: { draft: { include: { media: true } } },
      });
      if (!review) throw new AppError("Review tidak ditemukan.", 404);
      if (
        review.version !== review.draft.version ||
        Date.now() - review.createdAt.getTime() > 30 * 60 * 1000
      )
        throw new AppError(
          "Review sudah berubah atau kedaluwarsa. Review kembali.",
          409,
        );
      const snapshot = review.snapshot as unknown as Snapshot;
      const accounts = await db.account.findMany({
        where: { platform: { in: snapshot.platforms } },
      });
      if (
        snapshot.accounts.some(
          (old) =>
            !accounts.some(
              (a) =>
                a.platform === old.platform &&
                a.updatedAt.toISOString() === old.updatedAt,
            ),
        )
      )
        throw new AppError(
          "Akun tujuan berubah. Review kembali sebelum publish.",
          409,
        );
      const issues = validateContent(
        snapshot,
        review.draft.media,
        accounts.map(accountView) as AccountInfo[],
        hasRemoteStorage(),
      );
      if (issues.some((i) => i.severity === "error"))
        throw new AppError(
          "Konten atau koneksi tidak lagi valid. Review kembali.",
          409,
        );
      if (
        (issues.some((i) => i.severity === "warning") ||
          snapshot.warnings?.length) &&
        !acknowledgedWarnings
      )
        throw new AppError("Baca dan setujui peringatan sebelum publish.");
      const batch = await db.$transaction(async (tx) => {
        // The row lock serializes edits and confirmations of this draft.
        await tx.$queryRaw`SELECT id FROM "Draft" WHERE id = ${review.draftId} FOR UPDATE`;
        const current = await tx.draft.findUniqueOrThrow({
          where: { id: review.draftId },
        });
        if (current.version !== review.version)
          throw new AppError(
            "Draft berubah selama konfirmasi. Review kembali.",
            409,
          );
        const prior = await tx.batch.findUnique({ where: { reviewId } });
        if (prior) return prior;
        for (const target of [...snapshot.accounts].sort((a, b) =>
          a.platform.localeCompare(b.platform),
        ))
          await tx.$queryRaw`SELECT platform FROM "Account" WHERE platform = ${target.platform} FOR UPDATE`;
        const lockedAccounts = await tx.account.findMany({
          where: { platform: { in: snapshot.platforms } },
        });
        if (
          snapshot.accounts.some(
            (old) =>
              !lockedAccounts.some(
                (a) =>
                  a.platform === old.platform &&
                  a.status === "CONNECTED" &&
                  a.updatedAt.toISOString() === old.updatedAt,
              ),
          )
        )
          throw new AppError(
            "Koneksi akun berubah selama konfirmasi. Review kembali.",
            409,
          );
        return tx.batch.create({
          data: {
            reviewId,
            draftId: review.draftId,
            title: snapshot.title,
            jobs: {
              create: snapshot.accounts.map((a) => ({
                platform: a.platform,
                externalAccountId: a.externalId,
                accountLabel: a.label,
                snapshot: jsonValue(snapshot),
              })),
            },
          },
        });
      });
      return Response.json({ id: batch.id }, { status: 201 });
    }
    if (resource === "accounts" && id) {
      const platform = platformSchema.parse(id);
      if (
        method === "POST" &&
        (action === "discover" || action === "connect")
      ) {
        if (platform !== "instagram" && platform !== "facebook")
          throw new AppError(
            "Deteksi otomatis tersedia untuk Instagram dan Facebook.",
          );
        const body = await readJson(request);
        const input = metaTokenSchema.parse(
          action === "connect"
            ? { token: metaConnectSchema.parse(body).token }
            : body,
        );
        const candidates = await discoverMetaAccounts(platform, input.token);
        if (action === "discover")
          return Response.json({ accounts: publicMetaChoices(candidates) });
        const { externalId } = metaConnectSchema.parse(body);
        const selected = candidates.find(
          (candidate) => candidate.externalId === externalId,
        );
        if (!selected)
          throw new AppError(
            "Akun pilihan tidak ditemukan pada token ini. Jalankan deteksi kembali.",
          );
        return Response.json(
          accountView(await saveAccount(platform, selected, true)),
        );
      }
      if (method === "PUT") {
        const input = accountSchema.parse(await readJson(request));
        const pattern =
          platform === "linkedin"
            ? /^urn:li:(person|organization):[a-zA-Z0-9_-]+$/
            : platform === "youtube"
              ? /^UC[a-zA-Z0-9_-]{22}$/
              : /^\d+$/;
        if (!pattern.test(input.externalId))
          throw new AppError("ID akun tidak sesuai format platform.");
        if (input.token && input.token.length < 10)
          throw new AppError("Access token terlalu pendek.");
        const updated = await saveAccount(platform, input);
        return Response.json(accountView(updated));
      }
      if (method === "POST" && action === "check") {
        const account = await db.account.findUnique({ where: { platform } });
        if (!account)
          throw new AppError("Simpan akun dan token terlebih dahulu.");
        let result: { status: string; message: string; label?: string };
        try {
          result = { ...(await checkAccount(account)), status: "CONNECTED" };
        } catch (error) {
          result = {
            status: "ERROR",
            message:
              error instanceof ProviderError
                ? error.message
                : "Koneksi belum dapat diperiksa. Coba kembali.",
          };
        }
        const updated = await db.account.updateMany({
          where: { platform, updatedAt: account.updatedAt },
          data: { ...result, checkedAt: new Date() },
        });
        if (!updated.count)
          throw new AppError(
            "Akun berubah selama pemeriksaan. Jalankan cek koneksi kembali.",
            409,
          );
        return Response.json(
          accountView(
            await db.account.findUniqueOrThrow({ where: { platform } }),
          ),
        );
      }
      if (method === "DELETE") {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT platform FROM "Account" WHERE platform = ${platform} FOR UPDATE`;
          if (
            await tx.publicationJob.count({
              where: { platform, state: { in: ["UPLOADING", "PROCESSING"] } },
            })
          )
            throw new AppError(
              "Tunggu proses platform selesai sebelum memutus koneksi.",
              409,
            );
          await tx.publicationJob.updateMany({
            where: { platform, state: "QUEUED" },
            data: {
              state: "CANCELED",
              message: "Koneksi akun diputus sebelum publikasi.",
            },
          });
          await tx.account.deleteMany({ where: { platform } });
        });
        return Response.json({ ok: true });
      }
    }
    if (resource === "jobs" && method === "POST" && id && action === "retry") {
      uuid.parse(id);
      const job = await db.publicationJob.findUnique({ where: { id } });
      if (!job) throw new AppError("Pekerjaan tidak ditemukan.", 404);
      if (job.state !== "FAILED" || job.externalId)
        throw new AppError(
          "Pekerjaan ini tidak aman dicoba ulang. Periksa platform terlebih dahulu.",
          409,
        );
      const account = await db.account.findUnique({
        where: { platform: job.platform },
      });
      if (
        account?.status !== "CONNECTED" ||
        account.externalId !== job.externalAccountId
      )
        throw new AppError(
          "Periksa koneksi akun tujuan yang sama sebelum retry.",
        );
      await db.publicationJob.updateMany({
        where: { id, state: "FAILED" },
        data: {
          state: "QUEUED",
          message: "Menunggu percobaan ulang",
          availableAt: new Date(),
          attempts: 0,
        },
      });
      return Response.json({ ok: true });
    }
    throw new AppError("Endpoint tidak ditemukan.", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues[0]?.message || "Input tidak valid." },
        { status: 400 },
      );
    if (error instanceof AppError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ProviderError)
      return Response.json(
        { error: error.message },
        { status: error.retryable ? 503 : 400 },
      );
    console.error(
      "API operation failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      {
        error:
          "Operasi belum berhasil. Pastikan database aktif, lalu coba kembali.",
      },
      { status: 500 },
    );
  }
}
