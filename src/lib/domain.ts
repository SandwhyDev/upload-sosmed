import { z } from "zod";

export const platforms = [
  "instagram",
  "facebook",
  "youtube",
  "linkedin",
] as const;
export type Platform = (typeof platforms)[number];
export const youtubeOAuthCallbackPath = "/api/accounts/youtube/callback";
export const linkedinOAuthCallbackPath = "/api/accounts/linkedin/callback";
export type MetaPlatform = "instagram" | "facebook";
export type MetaAccountChoice = {
  externalId: string;
  label: string;
  loginType: "instagram" | "facebook";
};
export const platformNames: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};
export const youtubeSchema = z.object({
  title: z.string().max(100).default(""),
  categoryId: z.string().regex(/^\d+$/).default("22"),
  privacy: z.enum(["private", "unlisted", "public"]).default("private"),
  madeForKids: z.enum(["", "yes", "no"]).default(""),
  synthetic: z.enum(["", "yes", "no"]).default(""),
});
export const draftSchema = z
  .object({
    title: z.string().trim().min(1, "Beri judul internal konten.").max(150),
    caption: z.string().max(63206).default(""),
    platforms: z
      .array(z.enum(platforms))
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    variants: z
      .partialRecord(z.enum(platforms), z.string().max(63206))
      .default({}),
    youtube: youtubeSchema,
    mediaId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type DraftInput = z.infer<typeof draftSchema>;
export type MediaInfo = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec?: string | null;
  audioCodec?: string | null;
};
export type AccountInfo = {
  platform: Platform;
  label: string;
  externalId: string;
  loginType: string;
  status: string;
  message: string;
  checkedAt: string | null;
  updatedAt: string;
  hasToken: boolean;
};
export type DraftInfo = DraftInput & {
  id: string;
  version: number;
  updatedAt: string;
  media: MediaInfo | null;
};
export type JobInfo = {
  id: string;
  platform: Platform;
  state: string;
  message: string;
  accountLabel: string;
  externalUrl: string | null;
  externalId: string | null;
  attempts: number;
  updatedAt: string;
};
export type BatchInfo = {
  id: string;
  title: string;
  createdAt: string;
  jobs: JobInfo[];
};
export type AppState = {
  drafts: DraftInfo[];
  media: MediaInfo[];
  accounts: AccountInfo[];
  batches: BatchInfo[];
  workerOnline: boolean;
  storage: string;
};
export type Issue = {
  platform: Platform;
  message: string;
  severity: "error" | "warning";
};
export type Snapshot = DraftInput & {
  media: MediaInfo | null;
  warnings?: Issue[];
  accounts: {
    platform: Platform;
    externalId: string;
    label: string;
    loginType: string;
    updatedAt: string;
  }[];
};

export function newDraft(): DraftInput {
  return {
    title: "",
    caption: "",
    platforms: [],
    variants: {} as Record<Platform, string>,
    mediaId: null,
    youtube: {
      title: "",
      categoryId: "22",
      privacy: "private",
      madeForKids: "",
      synthetic: "",
    },
  };
}
export function captionFor(
  draft: Pick<DraftInput, "caption" | "variants">,
  platform: Platform,
) {
  return draft.variants[platform] ?? draft.caption;
}
export function validateContent(
  draft: DraftInput,
  media: MediaInfo | null,
  accounts: Pick<AccountInfo, "platform" | "status" | "message">[],
  remoteMedia: boolean,
): Issue[] {
  const issues: Issue[] = [];
  for (const platform of draft.platforms) {
    const error = (message: string) =>
      issues.push({ platform, message, severity: "error" });
    const warning = (message: string) =>
      issues.push({ platform, message, severity: "warning" });
    const account = accounts.find((a) => a.platform === platform);
    if (!account || account.status !== "CONNECTED")
      error(
        account?.message ||
          "Hubungkan dan periksa akun tujuan terlebih dahulu.",
      );
    const caption = captionFor(draft, platform);
    const max = {
      instagram: 2200,
      facebook: 63206,
      youtube: 5000,
      linkedin: 3000,
    }[platform];
    if (caption.length > max)
      error(`Teks melebihi ${max.toLocaleString("id-ID")} karakter.`);
    if (!caption.trim() && !media) error("Tambahkan teks atau media.");
    if (platform === "instagram") {
      if (!media) error("Instagram memerlukan gambar atau video.");
      if (media && !remoteMedia)
        error(
          "Konfigurasikan Cloudinary atau R2 agar Instagram dapat mengambil media.",
        );
      if (media?.mime === "image/png")
        error("Gunakan gambar JPEG untuk Instagram.");
      if (media?.mime === "video/mp4") {
        if (
          media.duration !== null &&
          (media.duration < 3 || media.duration > 900)
        )
          error("Durasi Reel harus 3 detik sampai 15 menit.");
        if (media.codec && !["h264", "hevc"].includes(media.codec))
          error("Codec video Instagram harus H.264 atau HEVC.");
        if (
          media.width &&
          media.height &&
          Math.abs(media.width / media.height - 9 / 16) > 0.04
        )
          warning(
            "Rasio 9:16 disarankan untuk Reel. Media tidak dipotong otomatis.",
          );
      }
    }
    if (platform === "youtube") {
      if (media?.mime !== "video/mp4") error("YouTube memerlukan video MP4.");
      if (!draft.youtube.title.trim()) error("Isi judul video YouTube.");
      if (!draft.youtube.madeForKids)
        error("Tentukan apakah video dibuat untuk anak-anak.");
      if (!draft.youtube.synthetic)
        error("Tentukan deklarasi konten sintetis.");
    }
    if (platform === "linkedin" && media?.mime === "video/mp4") {
      if (
        media.duration !== null &&
        (media.duration < 3 || media.duration > 1800)
      )
        error("Video LinkedIn harus 3 detik sampai 30 menit.");
      if (media.size < 75000) error("Video LinkedIn minimum 75 KB.");
    }
  }
  return issues;
}
export const stateLabels: Record<string, string> = {
  QUEUED: "Mengantre",
  UPLOADING: "Mengunggah",
  PROCESSING: "Diproses platform",
  SUCCEEDED: "Berhasil",
  FAILED: "Gagal",
  NEEDS_CHECK: "Perlu dicek",
  CANCELED: "Dibatalkan",
};
export function batchStatus(jobs: Pick<JobInfo, "state">[]) {
  if (jobs.some((j) => j.state === "NEEDS_CHECK")) return "Perlu dicek";
  if (jobs.some((j) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(j.state)))
    return "Dalam proses";
  if (jobs.every((j) => j.state === "SUCCEEDED")) return "Berhasil";
  if (jobs.some((j) => j.state === "SUCCEEDED")) return "Sebagian berhasil";
  if (jobs.every((j) => j.state === "CANCELED")) return "Dibatalkan";
  return "Gagal";
}
