import { createReadStream } from "node:fs";
import { openAsBlob } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { captionFor, type Platform, type Snapshot } from "../lib/domain";
import { decryptToken } from "./security";
import { mediaPath, remoteMediaUrl } from "./media";
import { CloudinaryUploadError } from "./cloudinary";
import {
  detectYoutubeChannel,
  refreshYoutubeAccessToken,
  YoutubeOAuthError,
} from "./youtube-oauth";
import type { Account } from "../generated/prisma/client";

export class ProviderError extends Error {
  constructor(
    message: string,
    public uncertain = false,
    public retryable = false,
  ) {
    super(message);
  }
}
const graphVersion = () => process.env.META_API_VERSION || "v27.0";
const liHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || "202610",
  "X-Restli-Protocol-Version": "2.0.0",
  "Content-Type": "application/json",
});
function checkUrl(url: string) {
  const parsed = new URL(url);
  const hosts = [
    "graph.facebook.com",
    "graph-video.facebook.com",
    "graph.instagram.com",
    "www.googleapis.com",
    "youtube.googleapis.com",
    "api.linkedin.com",
    "www.linkedin.com",
  ];
  if (
    parsed.protocol !== "https:" ||
    parsed.port ||
    !(
      hosts.includes(parsed.hostname) ||
      parsed.hostname.endsWith(".linkedin.com") ||
      parsed.hostname.endsWith(".licdn.com")
    )
  )
    throw new ProviderError(
      "Provider memberikan alamat upload yang tidak diizinkan.",
    );
}
export async function providerRequest(
  url: string,
  init: RequestInit = {},
  uncertainOnFailure = false,
) {
  checkUrl(url);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(
        init.body instanceof Readable || init.body instanceof FormData
          ? 600000
          : 60000,
      ),
      ...("body" in init ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    throw new ProviderError(
      "Koneksi ke platform terputus. Periksa hasil di platform sebelum mencoba ulang.",
      uncertainOnFailure,
      true,
    );
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    const message =
      status === 401
        ? "Token ditolak atau kedaluwarsa. Perbarui di Akun terhubung."
        : status === 403
          ? "Izin API tidak cukup untuk tindakan ini. Periksa scope dan peran akun."
          : status === 429
            ? "Batas API tercapai. Coba kembali setelah beberapa saat."
            : `Platform menolak permintaan (HTTP ${status}). Periksa izin, metadata, dan spesifikasi media.`;
    throw new ProviderError(
      message,
      uncertainOnFailure && status >= 500,
      status === 429 || status >= 500,
    );
  }
  return response;
}
import { Readable } from "node:stream";
async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
} // Provider schemas differ; fields are validated before use.
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    throw new ProviderError(`Respons platform tidak memiliki ${label}.`, true);
  return value;
}
const postForm = (fields: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(fields),
});

async function accountAccess(account: Account) {
  const secret = await decryptToken(account.secret);
  if (account.platform !== "youtube" || account.loginType !== "google")
    return { token: secret };
  try {
    const token = await refreshYoutubeAccessToken(secret);
    const channel = await detectYoutubeChannel(token);
    if (channel.externalId !== account.externalId)
      throw new ProviderError(
        "Kanal YouTube pada izin Google berubah. Hubungkan ulang kanal tujuan.",
      );
    return { token, youtubeLabel: channel.label };
  } catch (error) {
    if (error instanceof YoutubeOAuthError)
      throw new ProviderError(error.message, false, error.retryable);
    throw error;
  }
}

export async function checkAccount(account: Account) {
  const { token, youtubeLabel } = await accountAccess(account);
  if (account.platform === "instagram") {
    const host =
      account.loginType === "instagram"
        ? "graph.instagram.com"
        : "graph.facebook.com";
    const data = await json(
      await providerRequest(
        account.loginType === "instagram"
          ? `https://${host}/${graphVersion()}/me?fields=user_id,username`
          : `https://${host}/${graphVersion()}/${account.externalId}?fields=id,username`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    if (
      String(account.loginType === "instagram" ? data.user_id : data.id) !==
      account.externalId
    )
      throw new ProviderError("Identitas akun Instagram tidak cocok.");
    return {
      label:
        typeof data.username === "string" ? "@" + data.username : account.label,
      message:
        "Identitas akun terverifikasi. Izin publikasi final diperiksa oleh platform saat publish.",
    };
  }
  if (account.platform === "facebook") {
    const data = await json(
      await providerRequest(
        `https://graph.facebook.com/${graphVersion()}/me?fields=id,name`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    if (String(data.id) !== account.externalId)
      throw new ProviderError(
        "Gunakan Page access token yang mewakili Page ID ini, bukan user token.",
      );
    return {
      label: required(data.name, "nama Page"),
      message:
        "Identitas Page terverifikasi. Hak menulis tetap mengikuti izin token dan peran Page.",
    };
  }
  if (account.platform === "youtube") {
    if (youtubeLabel)
      return {
        label: youtubeLabel,
        message:
          "Kanal terverifikasi melalui Google. Token diperbarui otomatis saat digunakan.",
      };
    const data = await json(
      await providerRequest(
        "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    const channel = data.items?.find(
      (item: { id: string }) => item.id === account.externalId,
    );
    if (!channel)
      throw new ProviderError(
        "Kanal tidak cocok atau izin baca kanal belum tersedia. Tambahkan scope youtube.readonly untuk cek koneksi.",
      );
    return {
      label: required(channel.snippet?.title, "nama kanal"),
      message:
        "Kanal terverifikasi. Token juga membutuhkan scope youtube.upload untuk publikasi.",
    };
  }
  if (account.externalId.startsWith("urn:li:organization:")) {
    const id = account.externalId.split(":").at(-1);
    const data = await json(
      await providerRequest(
        `https://api.linkedin.com/rest/organizations/${id}`,
        { headers: liHeaders(token) },
      ),
    );
    return {
      label:
        typeof data.localizedName === "string"
          ? data.localizedName
          : account.label,
      message:
        "Organisasi dapat dibaca. Peran dan w_organization_social akan diperiksa saat publish.",
    };
  }
  const data = await json(
    await providerRequest("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  if ("urn:li:person:" + String(data.sub) !== account.externalId)
    throw new ProviderError(
      "URN author tidak cocok dengan identitas token. Scope openid/profile diperlukan untuk cek identitas.",
    );
  return {
    label: typeof data.name === "string" ? data.name : account.label,
    message:
      "Identitas profil terverifikasi. w_member_social diperlukan untuk publikasi.",
  };
}

export type PublishContext = {
  checkpoint: (
    value: Record<string, unknown>,
    message: string,
    externalId?: string,
  ) => Promise<void>;
  processing: (message: string) => Promise<void>;
};
export async function publishToPlatform(
  platform: Platform,
  account: Account,
  snapshot: Snapshot,
  context: PublishContext,
) {
  const { token } = await accountAccess(account),
    caption = captionFor(snapshot, platform),
    media = snapshot.media;
  const auth = { Authorization: `Bearer ${token}` };
  if (platform === "instagram") {
    if (!media) throw new ProviderError("Media Instagram tidak tersedia.");
    const host =
        account.loginType === "instagram"
          ? "graph.instagram.com"
          : "graph.facebook.com",
      base = `https://${host}/${graphVersion()}`;
    await context.checkpoint(
      {},
      "Mengunggah media agar dapat diambil Instagram.",
    );
    let url: string;
    try {
      url = await remoteMediaUrl(media);
    } catch (error) {
      if (error instanceof CloudinaryUploadError)
        throw new ProviderError(error.message, false, error.retryable);
      throw error;
    }
    const fields: Record<string, string> = media.mime.startsWith("video/")
      ? { media_type: "REELS", video_url: url, caption }
      : { image_url: url, caption };
    const container = await json(
      await providerRequest(`${base}/${account.externalId}/media`, {
        ...postForm(fields),
        headers: auth,
      }),
    );
    const containerId = required(container.id, "container ID");
    await context.checkpoint(
      { containerId },
      "Media diterima Instagram; menunggu pemrosesan.",
    );
    await context.processing("Instagram sedang menyiapkan media.");
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const data = await json(
        await providerRequest(`${base}/${containerId}?fields=status_code`, {
          headers: auth,
        }),
      );
      if (data.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (["ERROR", "EXPIRED"].includes(data.status_code))
        throw new ProviderError(
          "Instagram gagal memproses media. Periksa spesifikasi file.",
        );
      await delay(5000);
    }
    if (!ready)
      throw new ProviderError(
        "Pemrosesan Instagram belum selesai. Periksa sebelum publikasi ulang.",
        true,
      );
    await context.checkpoint(
      { containerId, publishStarted: true },
      "Menerbitkan media Instagram.",
    );
    const result = await json(
      await providerRequest(
        `${base}/${account.externalId}/media_publish`,
        { ...postForm({ creation_id: containerId }), headers: auth },
        true,
      ),
    );
    const id = required(result.id, "media ID");
    await context.checkpoint(
      { containerId, published: true },
      "Instagram menerima publikasi.",
      id,
    );
    let permalink: string | undefined;
    try {
      const data = await json(
        await providerRequest(`${base}/${id}?fields=permalink`, {
          headers: auth,
        }),
      );
      if (
        typeof data.permalink === "string" &&
        /^https:\/\/(www\.)?instagram\.com\//.test(data.permalink)
      )
        permalink = data.permalink;
    } catch {}
    return { id, url: permalink, message: "Diterbitkan ke Instagram." };
  }
  if (platform === "facebook") {
    const base = `https://graph.facebook.com/${graphVersion()}/${account.externalId}`;
    let init: RequestInit, endpoint: string;
    if (!media) {
      endpoint = `${base}/feed`;
      init = postForm({ message: caption });
    } else {
      const form = new FormData();
      form.append(
        media.mime.startsWith("video/") ? "description" : "caption",
        caption,
      );
      form.append(
        "source",
        await openAsBlob(mediaPath(media.id), { type: media.mime }),
        media.name,
      );
      endpoint = media.mime.startsWith("video/")
        ? `https://graph-video.facebook.com/${graphVersion()}/${account.externalId}/videos`
        : `${base}/photos`;
      init = { method: "POST", body: form };
    }
    await context.checkpoint(
      { publishStarted: true },
      "Mengirim posting ke Facebook.",
    );
    const data = await json(
      await providerRequest(endpoint, { ...init, headers: auth }, true),
    );
    const id = required(data.post_id || data.id, "post ID");
    await context.checkpoint(
      { published: true },
      "Facebook menerima posting.",
      id,
    );
    if (media?.mime.startsWith("video/")) {
      await context.processing("Facebook sedang memproses video.");
      let ready = false;
      for (let i = 0; i < 120; i++) {
        const video = await json(
          await providerRequest(
            `https://graph.facebook.com/${graphVersion()}/${id}?fields=status`,
            { headers: auth },
          ),
        );
        if (video.status?.video_status === "ready") {
          ready = true;
          break;
        }
        if (video.status?.video_status === "error")
          throw new ProviderError("Facebook menolak pemrosesan video.", true);
        await delay(5000);
      }
      if (!ready)
        throw new ProviderError(
          "Video diterima Facebook tetapi status akhirnya belum dapat dipastikan.",
          true,
        );
    }
    return {
      id,
      url: `https://www.facebook.com/${id}`,
      message: "Facebook menerima posting. Periksa visibilitas di Page.",
    };
  }
  if (platform === "youtube") {
    if (!media) throw new ProviderError("Video tidak ditemukan.");
    const metadata = {
      snippet: {
        title: snapshot.youtube.title,
        description: caption,
        categoryId: snapshot.youtube.categoryId,
      },
      status: {
        privacyStatus: snapshot.youtube.privacy,
        selfDeclaredMadeForKids: snapshot.youtube.madeForKids === "yes",
        containsSyntheticMedia: snapshot.youtube.synthetic === "yes",
      },
    };
    const response = await providerRequest(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/json",
          "X-Upload-Content-Length": String(media.size),
          "X-Upload-Content-Type": media.mime,
        },
        body: JSON.stringify(metadata),
      },
    );
    const location = required(
      response.headers.get("location"),
      "alamat upload",
    );
    checkUrl(location);
    await context.checkpoint(
      { session: location },
      "Sesi unggah YouTube dibuat.",
    );
    const upload = await providerRequest(
      location,
      {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": media.mime,
          "Content-Length": String(media.size),
        },
        body: createReadStream(mediaPath(media.id)) as unknown as BodyInit,
      },
      true,
    );
    const data = await json(upload),
      id = required(data.id, "video ID");
    await context.checkpoint({ uploaded: true }, "YouTube menerima video.", id);
    await context.processing("YouTube sedang memproses video.");
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const result = await json(
        await providerRequest(
          `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`,
          { headers: auth },
        ),
      );
      const video = result.items?.[0];
      if (
        video?.status?.uploadStatus === "processed" ||
        video?.processingDetails?.processingStatus === "succeeded"
      ) {
        ready = true;
        break;
      }
      if (
        ["failed", "rejected", "deleted"].includes(video?.status?.uploadStatus)
      )
        throw new ProviderError(
          "YouTube menolak atau gagal memproses video. Periksa YouTube Studio.",
          true,
        );
      await delay(5000);
    }
    if (!ready)
      throw new ProviderError(
        "Video sudah diterima YouTube; pemrosesan belum dapat dipastikan.",
        true,
      );
    return {
      id,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      message: `Video selesai diproses. Privasi yang diminta: ${snapshot.youtube.privacy}. Periksa status aktual di YouTube Studio.`,
    };
  }
  let asset: string | undefined;
  const headers = liHeaders(token);
  if (media) {
    if (media.mime.startsWith("image/")) {
      const init = await json(
        await providerRequest(
          "https://api.linkedin.com/rest/images?action=initializeUpload",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              initializeUploadRequest: { owner: account.externalId },
            }),
          },
        ),
      );
      asset = required(init.value?.image, "image URN");
      const url = required(init.value?.uploadUrl, "alamat upload");
      await context.checkpoint({ asset }, "Mengunggah gambar LinkedIn.");
      await providerRequest(url, {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": media.mime,
          "Content-Length": String(media.size),
        },
        body: createReadStream(mediaPath(media.id)) as unknown as BodyInit,
      });
    } else {
      const init = await json(
        await providerRequest(
          "https://api.linkedin.com/rest/videos?action=initializeUpload",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              initializeUploadRequest: {
                owner: account.externalId,
                fileSizeBytes: media.size,
                uploadCaptions: false,
                uploadThumbnail: false,
              },
            }),
          },
        ),
      );
      const value = init.value;
      asset = required(value?.video, "video URN");
      if (
        !Array.isArray(value.uploadInstructions) ||
        value.uploadInstructions.length > 200
      )
        throw new ProviderError("Instruksi upload LinkedIn tidak valid.");
      await context.checkpoint({ asset }, "Mengunggah video LinkedIn.");
      const parts: string[] = [];
      for (const instruction of value.uploadInstructions) {
        const start = Number(instruction.firstByte),
          end = Number(instruction.lastByte);
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          end >= media.size
        )
          throw new ProviderError("Rentang upload LinkedIn tidak valid.");
        const response = await providerRequest(
          required(instruction.uploadUrl, "alamat upload"),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(end - start + 1),
            },
            body: createReadStream(mediaPath(media.id), {
              start,
              end,
            }) as unknown as BodyInit,
          },
        );
        parts.push(
          required(response.headers.get("etag"), "ETag").replace(/^"|"$/g, ""),
        );
      }
      await providerRequest(
        "https://api.linkedin.com/rest/videos?action=finalizeUpload",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            finalizeUploadRequest: {
              video: asset,
              uploadToken: value.uploadToken,
              uploadedPartIds: parts,
            },
          }),
        },
      );
    }
    await context.processing("LinkedIn sedang memproses media.");
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const data = await json(
        await providerRequest(
          `https://api.linkedin.com/rest/${media.mime.startsWith("image/") ? "images" : "videos"}/${encodeURIComponent(asset)}`,
          { headers },
        ),
      );
      if (data.status === "AVAILABLE") {
        ready = true;
        break;
      }
      if (["PROCESSING_FAILED", "FAILED"].includes(data.status))
        throw new ProviderError("LinkedIn gagal memproses media.");
      await delay(5000);
    }
    if (!ready)
      throw new ProviderError(
        "Media LinkedIn belum siap. Periksa sebelum mencoba ulang.",
        true,
      );
  }
  await context.checkpoint(
    { asset, publishStarted: true },
    "Menerbitkan posting LinkedIn.",
  );
  const response = await providerRequest(
    "https://api.linkedin.com/rest/posts",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        author: account.externalId,
        commentary: caption,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(asset
          ? { content: { media: { id: asset, title: snapshot.title } } }
          : {}),
      }),
    },
    true,
  );
  const id = required(response.headers.get("x-restli-id"), "post ID");
  await context.checkpoint(
    { published: true },
    "LinkedIn menerima posting.",
    id,
  );
  return {
    id,
    url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
    message: "LinkedIn menerima publikasi.",
  };
}
