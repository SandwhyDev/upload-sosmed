import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// Runtime user data must not be traced into the application build.
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR || ".data",
);
export class AppError extends Error {
  constructor(
    public message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function httpsOrigin() {
  const value = process.env.APP_ORIGIN?.trim();
  if (!value) return null;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || (url.protocol === "https:" && value !== url.origin))
    throw new AppError("APP_ORIGIN harus berupa origin HTTPS tanpa path.", 500);
  return url.protocol === "https:" ? url.origin : null;
}

export function assertLocalRequest(
  request: Request,
  allowOAuthRedirect = false,
) {
  const url = new URL(request.url),
    host = request.headers.get("host") ?? url.host;
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
  let hostUrl: URL;
  try {
    hostUrl = new URL("http://" + host);
  } catch {
    throw new AppError("Host tidak diizinkan.", 403);
  }
  const publicOrigin = httpsOrigin();
  if (publicOrigin) {
    const expected = process.env.RUANG_PROXY_SECRET ?? "";
    const provided = request.headers.get("x-ruang-proxy-secret") ?? "";
    const secretPattern = /^[a-f0-9]{64}$/;
    if (expected && !secretPattern.test(expected))
      throw new AppError("Konfigurasi akses reverse proxy belum lengkap.", 503);
    if (
      host !== new URL(publicOrigin).host ||
      (expected &&
        (!secretPattern.test(provided) ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))))
    )
      throw new AppError("Akses melalui reverse proxy diperlukan.", 403);
  } else if (!allowed.has(hostUrl.hostname) || !allowed.has(url.hostname))
    throw new AppError("Aplikasi hanya tersedia di localhost.", 403);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    site === "cross-site" &&
    !(allowOAuthRedirect && request.method === "GET")
  )
    throw new AppError("Request lintas situs ditolak.", 403);
  if (origin && origin !== (publicOrigin ?? hostUrl.origin))
    throw new AppError("Origin tidak diizinkan.", 403);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    (!origin || request.headers.get("x-ruang-request") !== "1")
  )
    throw new AppError("Request perubahan data tidak diizinkan.", 403);
}
let keyPromise: Promise<Buffer> | undefined;
async function key() {
  return (keyPromise ??= (async () => {
    await mkdir(dataDir, { recursive: true });
    const file = path.join(dataDir, "secret.key");
    try {
      return await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return readFile(file);
  })());
}
export async function encryptToken(token: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export async function decryptToken(value: string) {
  const buffer = Buffer.from(value, "base64"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      await key(),
      buffer.subarray(0, 12),
    );
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([
    decipher.update(buffer.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export async function readJson(request: Request, limit = 300_000) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new AppError("Data terlalu besar.", 413);
  const reader = request.body?.getReader();
  let total = 0;
  const parts: Uint8Array[] = [];
  if (!reader) throw new AppError("Data kosong.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new AppError("Data terlalu besar.", 413);
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new AppError("JSON tidak valid.");
  }
}
