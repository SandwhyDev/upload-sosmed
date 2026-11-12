import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import ffprobe from "ffprobe-static";
import { AppError, dataDir } from "./security";
import { db } from "./db";
import type { MediaInfo } from "../lib/domain";
import { hasCloudinaryStorage, uploadToCloudinary } from "./cloudinary";
export const mediaPath = (id: string) => path.join(dataDir, "media", id);
const hasR2Storage = () =>
  Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
export const remoteStorageName = () =>
  hasCloudinaryStorage() ? "Cloudinary" : hasR2Storage() ? "R2" : null;
export const hasRemoteStorage = () => remoteStorageName() !== null;
async function r2() {
  if (!hasR2Storage())
    throw new AppError("Penyimpanan R2 belum dikonfigurasi.");
  const endpoint = new URL(process.env.R2_ENDPOINT!);
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".r2.cloudflarestorage.com")
  )
    throw new AppError("Endpoint R2 tidak valid.");
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: endpoint.toString(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}
export async function remoteMediaUrl(media: MediaInfo) {
  if (hasCloudinaryStorage())
    return uploadToCloudinary(media, mediaPath(media.id));
  const [{ Upload }, { getSignedUrl }, { GetObjectCommand }] =
    await Promise.all([
      import("@aws-sdk/lib-storage"),
      import("@aws-sdk/s3-request-presigner"),
      import("@aws-sdk/client-s3"),
    ]);
  const client = await r2();
  await new Upload({
    client,
    params: {
      Bucket: process.env.R2_BUCKET!,
      Key: `media/${media.id}`,
      Body: createReadStream(mediaPath(media.id)),
      ContentType: media.mime,
    },
    queueSize: 2,
  }).done();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: `media/${media.id}`,
    }),
    { expiresIn: 3600 },
  );
}
let uploads = 0;
export async function uploadMedia(request: Request) {
  if (uploads >= 2)
    throw new AppError(
      "Dua upload sedang berjalan. Coba kembali setelah selesai.",
      429,
    );
  if (!request.body) throw new AppError("File kosong.");
  const requestedMime = request.headers.get("content-type")?.split(";")[0];
  if (!["image/jpeg", "image/png", "video/mp4"].includes(requestedMime || ""))
    throw new AppError("Gunakan JPEG, PNG, atau MP4.");
  const limit =
    requestedMime === "video/mp4" ? 500 * 1024 * 1024 : 25 * 1024 * 1024;
  const claimedSize = Number(request.headers.get("content-length") || 0);
  if (claimedSize > limit)
    throw new AppError("Ukuran file melebihi batas.", 413);
  let name: string;
  try {
    name = decodeURIComponent(request.headers.get("x-file-name") || "media")
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 200);
  } catch {
    throw new AppError("Nama file tidak valid.");
  }
  const id = randomUUID(),
    file = mediaPath(id);
  let size = 0;
  uploads++;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const limiter = new Transform({
      transform(chunk, _encoding, cb) {
        size += chunk.length;
        if (size > limit) cb(new AppError("Ukuran file melebihi batas.", 413));
        else cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      limiter,
      createWriteStream(file, { flags: "wx" }),
    );
    const detected = await fileTypeFromFile(file);
    if (!detected || detected.mime !== requestedMime)
      throw new AppError("Isi file tidak cocok dengan format yang dipilih.");
    let width: number | null = null,
      height: number | null = null,
      duration: number | null = null,
      codec: string | null = null,
      audioCodec: string | null = null;
    if (detected.mime.startsWith("image/")) {
      const metadata = await sharp(file, {
        limitInputPixels: 50_000_000,
      }).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      if (metadata.pages && metadata.pages > 1)
        throw new AppError("Gambar animasi belum didukung.");
    } else {
      const { stdout } = await promisify(execFile)(
        ffprobe.path,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
        { timeout: 20000, maxBuffer: 2_000_000, windowsHide: true },
      );
      const meta = JSON.parse(stdout),
        video = meta.streams?.find(
          (s: { codec_type: string }) => s.codec_type === "video",
        ),
        audio = meta.streams?.find(
          (s: { codec_type: string }) => s.codec_type === "audio",
        );
      if (!video) throw new AppError("File tidak memiliki stream video.");
      width = video.width ?? null;
      height = video.height ?? null;
      codec = video.codec_name ?? null;
      audioCodec = audio?.codec_name ?? null;
      duration = Number(meta.format?.duration) || null;
      if (!duration) throw new AppError("Durasi video tidak dapat dibaca.");
    }
    return await db.media.create({
      data: {
        id,
        name,
        mime: detected.mime,
        size,
        width,
        height,
        duration,
        codec,
        audioCodec,
      },
    });
  } catch (error) {
    await unlink(file).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError(
      "File tidak dapat diproses. Periksa apakah file rusak dan coba lagi.",
    );
  } finally {
    uploads--;
  }
}
