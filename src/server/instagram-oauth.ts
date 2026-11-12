import { z } from "zod";
import { AppError } from "./security";
import { createOAuthSession } from "./oauth-session";

const localOrigin = "http://127.0.0.1:3000";
const version = () => process.env.META_API_VERSION?.trim() || "v27.0";
const configuration = z.object({
  appId: z.string().regex(/^\d+$/),
  appSecret: z.string().min(1).max(512),
  configId: z.string().regex(/^\d+$/),
  redirectUri: z.url().refine((uri) => {
    if (!URL.canParse(uri)) return false;
    const url = new URL(uri);
    return (
      (url.protocol === "https:" ||
        (url.origin === localOrigin &&
          url.pathname === "/api/accounts/instagram/callback")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
});
const tokenResponse = z.object({
  access_token: z.string().min(10).max(5000).regex(/^\S+$/),
});
const accountList = z.object({
  data: z.array(
    z.object({
      id: z.string().regex(/^\d+$/),
      username: z.string().min(1).optional(),
    }),
  ),
  paging: z.object({ next: z.string().optional() }).optional(),
});
type Credentials = z.infer<typeof configuration>;
export const instagramOAuth = createOAuthSession<Credentials>("instagram");

export function startInstagramOAuth(
  request: Request,
  updatedAt: number | null,
) {
  const configured = configuration.safeParse({
    appId: process.env.META_APP_ID?.trim(),
    appSecret: process.env.META_APP_SECRET?.trim(),
    configId: process.env.INSTAGRAM_CONFIG_ID?.trim(),
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI?.trim(),
  });
  if (!configured.success)
    throw new AppError(
      "Isi Meta App ID, Meta App Secret, Instagram Configuration ID, dan Redirect URI di .env.local. Lihat panduan Unified Login di README.",
    );
  if (request.headers.get("origin") !== localOrigin)
    throw new AppError(
      "Buka http://127.0.0.1:3000 untuk menghubungkan Instagram.",
    );
  const { appId, configId, redirectUri } = configured.data;
  const { state, headers } = instagramOAuth.begin(
    request,
    configured.data,
    updatedAt,
  );
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    config_id: configId,
    display: "popup",
    override_default_response_type: "true",
    response_type: "code",
    state,
    prompt: "login",
  }).toString();
  return Response.json({ authorizationUrl: url.href }, { headers });
}

async function fetchJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError("Koneksi ke Meta terputus. Hubungkan kembali.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      "Meta menolak koneksi. Periksa Meta App ID, App Secret, Configuration ID, izin, dan Redirect URI.",
    );
  }
  return (await response.json().catch(() => null)) as unknown;
}

export async function finishInstagramOAuth(
  credentials: Credentials,
  code: string,
) {
  const tokenUrl = new URL(
    `https://graph.facebook.com/${version()}/oauth/access_token`,
  );
  tokenUrl.search = new URLSearchParams({
    client_id: credentials.appId,
    client_secret: credentials.appSecret,
    redirect_uri: credentials.redirectUri,
    code,
  }).toString();
  const parsedToken = tokenResponse.safeParse(await fetchJson(tokenUrl.href));
  if (!parsedToken.success)
    throw new AppError("Meta tidak memberikan access token yang dapat digunakan.");

  const accountsUrl = new URL(
    `https://graph.facebook.com/${version()}/me/assigned_instagram_accounts`,
  );
  accountsUrl.search = new URLSearchParams({
    fields: "id,username",
    access_token: parsedToken.data.access_token,
  }).toString();
  const parsedAccounts = accountList.safeParse(await fetchJson(accountsUrl.href));
  if (!parsedAccounts.success || !parsedAccounts.data.data.length)
    throw new AppError(
      "Akun Instagram tidak ditemukan. Pastikan akun dipilih sebagai aset pada konfigurasi Unified Login dan izinnya mencakup instagram_basic serta instagram_content_publish.",
    );
  if (parsedAccounts.data.data.length !== 1)
    throw new AppError(
      "Konfigurasi memberikan akses ke beberapa akun Instagram. Buat konfigurasi khusus dengan satu akun Instagram, lalu hubungkan kembali.",
    );
  const account = parsedAccounts.data.data[0];
  return {
    externalId: account.id,
    label: account.username ? "@" + account.username : "Instagram",
    // Unified Login returns a Meta Graph token, so Graph API calls use facebook.com.
    loginType: "facebook" as const,
    token: parsedToken.data.access_token,
  };
}
