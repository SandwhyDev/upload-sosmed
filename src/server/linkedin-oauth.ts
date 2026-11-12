import { z } from "zod";
import { linkedinOAuthCallbackPath } from "../lib/domain";
import { AppError } from "./security";
import { createOAuthSession } from "./oauth-session";

const scopes = ["openid", "profile", "w_member_social"];
const clientSchema = z
  .object({
    clientId: z.string().trim().min(1).max(300),
    clientSecret: z.string().trim().min(1).max(512),
  })
  .strict();
const tokenResponse = z.object({
  access_token: z.string().min(1).max(8192).regex(/^\S+$/),
  expires_in: z.number().int().positive().optional(),
});
const profileResponse = z.object({
  sub: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200).optional(),
  given_name: z.string().trim().min(1).max(100).optional(),
  family_name: z.string().trim().min(1).max(100).optional(),
});
type Pending = z.infer<typeof clientSchema> & {
  provider: "linkedin";
  redirectUri: string;
};

export const linkedinOAuth = createOAuthSession<Pending>("linkedin");

export function startLinkedInOAuth(
  request: Request,
  body: unknown,
  updatedAt: number | null,
) {
  const credentials = clientSchema.parse(body);
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin))
    throw new AppError("Buka aplikasi dari alamat lokalnya untuk menghubungkan LinkedIn.");
  const redirectUri = new URL(linkedinOAuthCallbackPath, origin).href;
  const entry: Pending = { ...credentials, provider: "linkedin", redirectUri };
  const { state, headers } = linkedinOAuth.begin(request, entry, updatedAt);
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(" "),
  }).toString();
  return Response.json({ authorizationUrl: url.href }, { headers });
}

async function linkedinJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError("Koneksi ke LinkedIn terputus. Coba kembali.", 503);
  }
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data;
  const status = response.status;
  if (status === 401)
    throw new AppError("LinkedIn menolak kredensial. Periksa Client ID dan Client Secret.");
  if (status === 429 || status >= 500)
    throw new AppError("LinkedIn sedang membatasi permintaan atau mengalami gangguan. Coba kembali.", 503);
  throw new AppError("LinkedIn menolak koneksi. Periksa produk, izin, dan Authorized redirect URL.");
}

export async function finishLinkedInOAuth(entry: Pending, code: string) {
  const tokenData = tokenResponse.safeParse(
    await linkedinJson("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: entry.redirectUri,
        client_id: entry.clientId,
        client_secret: entry.clientSecret,
      }),
    }),
  );
  if (!tokenData.success)
    throw new AppError("LinkedIn tidak memberikan access token yang dapat digunakan.");

  const profile = profileResponse.safeParse(
    await linkedinJson("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.data.access_token}` },
    }),
  );
  if (!profile.success)
    throw new AppError(
      "Identitas LinkedIn tidak dapat dibaca. Pastikan produk Sign In with LinkedIn using OpenID Connect aktif.",
    );
  const label =
    profile.data.name ||
    [profile.data.given_name, profile.data.family_name].filter(Boolean).join(" ");
  return {
    label: label || "LinkedIn",
    externalId: "urn:li:person:" + profile.data.sub,
    token: tokenData.data.access_token,
    loginType: "linkedin" as const,
  };
}
