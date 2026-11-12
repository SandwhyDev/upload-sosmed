import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import type { MediaInfo } from "../lib/domain";

export class CloudinaryUploadError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

export function hasCloudinaryStorage() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim(),
  );
}

export async function uploadToCloudinary(
  media: MediaInfo,
  filePath: string,
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (
    !cloudName ||
    !/^[a-zA-Z0-9_-]+$/.test(cloudName) ||
    !apiKey ||
    !apiSecret
  ) {
    throw new CloudinaryUploadError(
      "Lengkapi CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET di .env.local, lalu mulai ulang aplikasi.",
    );
  }
  if (
    !/^[a-f0-9-]{36}$/i.test(media.id) ||
    !["image/jpeg", "image/png", "video/mp4"].includes(media.mime)
  ) {
    throw new CloudinaryUploadError(
      "Identitas atau format media Cloudinary tidak valid.",
    );
  }
  let file: Blob;
  try {
    file = await openAsBlob(filePath, { type: media.mime });
  } catch {
    throw new CloudinaryUploadError(
      "File lokal tidak dapat dibaca untuk upload Cloudinary.",
    );
  }
  const maxSize =
    media.mime === "video/mp4" ? 500 * 1024 * 1024 : 25 * 1024 * 1024;
  if (!file.size || file.size !== media.size || file.size > maxSize) {
    throw new CloudinaryUploadError(
      "Ukuran file lokal berubah atau melebihi batas upload. Unggah ulang media.",
    );
  }
  const resourceType = media.mime.startsWith("video/") ? "video" : "image";
  const publicId = `ruang-konten/${media.id}`;
  // Reusing the immutable local media ID makes upload retries target the same cloud asset.
  const fields: Record<string, string> = {
    overwrite: "true",
    public_id: publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "upload",
  };
  const signed = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
  const signature = createHash("sha256")
    .update(signed + apiSecret)
    .digest("hex");
  const chunkSize = 20 * 1024 * 1024;
  const chunked = file.size > chunkSize;
  const uploadId = randomUUID();
  const uploadTimeout = AbortSignal.timeout(15 * 60 * 1000);
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size);
    const last = end === file.size;
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    body.set("api_key", apiKey);
    body.set("signature", signature);
    body.set(
      "file",
      file.slice(start, end, media.mime),
      resourceType === "video"
        ? "media.mp4"
        : media.mime === "image/png"
          ? "media.png"
          : "media.jpg",
    );
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
        {
          method: "POST",
          body,
          redirect: "error",
          signal: AbortSignal.any([uploadTimeout, AbortSignal.timeout(180000)]),
          headers: chunked
            ? {
                "X-Unique-Upload-Id": uploadId,
                "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
              }
            : {},
        },
      );
    } catch {
      throw new CloudinaryUploadError(
        "Upload Cloudinary terputus atau melewati batas waktu. Instagram belum menerima media; coba lagi.",
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      const message = [401, 403].includes(response.status)
        ? "Cloudinary menolak kredensial. Periksa API key, API secret, dan izin upload."
        : response.status === 413
          ? "Ukuran media melebihi batas akun Cloudinary. Periksa limit akun Anda."
          : response.status === 429
            ? "Batas API Cloudinary tercapai. Coba lagi setelah beberapa saat."
            : `Upload Cloudinary gagal (HTTP ${response.status}). Periksa format, batas akun, dan konfigurasi Cloudinary.`;
      throw new CloudinaryUploadError(
        message,
        response.status === 429 || response.status >= 500,
      );
    }
    let data: {
      done?: boolean;
      secure_url?: unknown;
      public_id?: unknown;
      resource_type?: unknown;
    };
    try {
      data = await response.json();
    } catch {
      throw new CloudinaryUploadError(
        "Respons upload Cloudinary tidak dapat dibaca. Instagram belum menerima media.",
      );
    }
    if (
      !data ||
      typeof data !== "object" ||
      (!last && data.done !== false) ||
      (last && (data.done === false || (chunked && data.done !== true)))
    ) {
      throw new CloudinaryUploadError(
        "Upload Cloudinary belum lengkap. Instagram belum menerima media.",
      );
    }
    if (!last) continue;
    let url: URL;
    try {
      url = new URL(typeof data.secure_url === "string" ? data.secure_url : "");
    } catch {
      throw new CloudinaryUploadError(
        "Cloudinary belum memberikan URL media yang valid.",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      url.port ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/${cloudName}/${resourceType}/upload/`) ||
      data.public_id !== publicId ||
      data.resource_type !== resourceType
    ) {
      throw new CloudinaryUploadError(
        "URL atau identitas media Cloudinary tidak sesuai. Publikasi dihentikan.",
      );
    }
    return url.toString();
  }
  throw new CloudinaryUploadError("Cloudinary belum memberikan URL media.");
}
