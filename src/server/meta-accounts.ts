import { z } from "zod";
import type { MetaAccountChoice, MetaPlatform } from "../lib/domain";
import { providerRequest, ProviderError } from "./providers";

type ResolvedAccount = MetaAccountChoice & { token: string };
const id = z.string().regex(/^\d+$/);
const identity = z.object({ user_id: id, username: z.string().min(1) });
const page = z.object({
  id,
  name: z.string().min(1),
  category: z.string().optional(),
  access_token: z.string().min(10).optional(),
  instagram_business_account: z
    .object({ id, username: z.string().optional() })
    .nullish(),
});
const pageList = z.object({
  data: z.array(page),
  paging: z
    .object({
      next: z.string().optional(),
      cursors: z.object({ after: z.string().max(2000).optional() }).optional(),
    })
    .optional(),
});

async function graph(
  host: string,
  path: string,
  fields: string,
  token: string,
  after?: string,
) {
  const url = new URL(
    `https://${host}/${process.env.META_API_VERSION || "v27.0"}/${path}`,
  );
  url.searchParams.set("fields", fields);
  if (path === "me/accounts") url.searchParams.set("limit", "100");
  if (after) url.searchParams.set("after", after);
  const response = await providerRequest(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProviderError(
      "Respons Meta tidak dapat dibaca. Coba deteksi kembali.",
    );
  }
}

async function probe<T>(
  read: () => Promise<unknown>,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let value: unknown;
  try {
    value = await read();
  } catch (error) {
    // A token for the other Meta login can be rejected; transport/rate errors must surface immediately.
    if (error instanceof ProviderError && !error.retryable) return null;
    throw error;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ProviderError(
      "Respons identitas Meta tidak lengkap. Coba deteksi kembali.",
    );
  return parsed.data;
}

export async function detectInstagramAccount(token: string) {
  const data = await graph(
    "graph.instagram.com",
    "me",
    "user_id,username",
    token,
  );
  const own = identity.safeParse(data);
  if (!own.success)
    throw new ProviderError("Identitas Instagram tidak lengkap.");
  return {
    externalId: own.data.user_id,
    label: "@" + own.data.username,
    loginType: "instagram" as const,
    token,
  };
}

export async function discoverMetaAccounts(
  platform: MetaPlatform,
  token: string,
): Promise<ResolvedAccount[]> {
  if (platform === "instagram") {
    const own = await probe(
      () => graph("graph.instagram.com", "me", "user_id,username", token),
      identity,
    );
    if (own)
      return [
        {
          externalId: own.user_id,
          label: "@" + own.username,
          loginType: "instagram",
          token,
        },
      ];
  }
  const fields =
    platform === "instagram"
      ? "id,name,category,instagram_business_account{id,username}"
      : "id,name,category";
  const own = await probe(
    () => graph("graph.facebook.com", "me", fields, token),
    page,
  );
  let pages: z.infer<typeof page>[] = [];
  if (own?.category) pages = [own];
  else {
    let after: string | undefined;
    const seen = new Set<string>();
    for (let count = 0; count < 5; count++) {
      const data = await probe(
        () =>
          graph(
            "graph.facebook.com",
            "me/accounts",
            fields + ",access_token",
            token,
            after,
          ),
        pageList,
      );
      if (!data)
        throw new ProviderError(
          "Token tidak dapat membaca akun. Periksa masa berlaku token dan izin pages_show_list/pages_read_engagement, lalu coba lagi.",
        );
      pages.push(...data.data);
      if (!data.paging?.next) break;
      after = data.paging.cursors?.after;
      if (!after || seen.has(after) || count === 4)
        throw new ProviderError(
          "Daftar akun belum dapat diambil lengkap. Batasi akses token ke Page yang ingin dihubungkan, lalu coba lagi.",
        );
      seen.add(after);
    }
  }
  const results = new Map<string, ResolvedAccount>();
  for (const item of pages) {
    const pageToken = own?.category ? token : item.access_token;
    if (!pageToken) continue;
    const instagram = item.instagram_business_account;
    if (platform === "instagram" && !instagram) continue;
    const externalId = platform === "instagram" ? instagram!.id : item.id;
    results.set(externalId, {
      externalId,
      label:
        platform === "instagram"
          ? instagram?.username
            ? "@" + instagram.username
            : "Instagram · " + item.name
          : item.name,
      loginType: "facebook",
      token: pageToken,
    });
  }
  if (!results.size)
    throw new ProviderError(
      platform === "instagram"
        ? "Akun Instagram profesional tidak ditemukan. Gunakan token Instagram Login, atau token Facebook dengan akses Page yang terhubung ke akun Business/Creator."
        : "Tidak ada Facebook Page yang dapat dihubungkan. Pastikan token memiliki akses ke Page dan izin pages_show_list; profil pribadi tidak didukung.",
    );
  return [...results.values()];
}

export function publicMetaChoices(
  accounts: ResolvedAccount[],
): MetaAccountChoice[] {
  return accounts.map(({ externalId, label, loginType }) => ({
    externalId,
    label,
    loginType,
  }));
}
