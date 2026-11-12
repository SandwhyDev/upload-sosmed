import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { youtubeOAuthCallbackPath } from "../lib/domain";
import { AppError } from "./security";
import { createOAuthSession } from "./oauth-session";

const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
const clientSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .max(300)
      .regex(
        /^[\w-]+\.apps\.googleusercontent\.com$/,
        "Masukkan Client ID OAuth Google yang valid.",
      ),
    clientSecret: z
      .string()
      .trim()
      .min(1, "Masukkan Client Secret Google.")
      .max(512),
  })
  .strict();
const tokenString = z.string().min(1).max(8192).regex(/^\S+$/);
const credentialsSchema = clientSchema.extend({ refreshToken: tokenString });
const tokenResponse = z.object({
  access_token: tokenString,
  refresh_token: tokenString.optional(),
  scope: z.string().optional(),
});
const channelsResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^UC[\w-]{22}$/),
        snippet: z.object({ title: z.string().trim().min(1).max(100) }),
      }),
    )
    .max(2)
    .default([]),
  nextPageToken: z.string().optional(),
});

export class YoutubeOAuthError extends AppError {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message, retryable ? 503 : 400);
  }
}

type Pending = z.infer<typeof clientSchema> & {
  verifier: string;
  redirectUri: string;
};

export const youtubeOAuth = createOAuthSession<Pending>("youtube");

export function startYoutubeOAuth(
  request: Request,
  body: unknown,
  updatedAt: number | null,
) {
  const credentials = clientSchema.parse(body);
  const entry = {
    ...credentials,
    verifier: randomBytes(32).toString("base64url"),
    redirectUri: new URL(
      youtubeOAuthCallbackPath,
      request.headers.get("origin")!,
    ).href,
  };
  const { state, headers } = youtubeOAuth.begin(request, entry, updatedAt);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: entry.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: createHash("sha256")
      .update(entry.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return Response.json({ authorizationUrl: url.href }, { headers });
}

async function googleJson(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new YoutubeOAuthError(
      "Koneksi ke Google terputus. Coba kembali.",
      true,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data;
  const error = z.object({ error: z.string() }).safeParse(data);
  const code = error.success ? error.data.error : null;
  if (code === "invalid_client")
    throw new YoutubeOAuthError(
      "Google menolak Client ID atau Client Secret. Periksa kredensial OAuth Anda.",
    );
  if (code === "invalid_grant")
    throw new YoutubeOAuthError(
      "Izin Google kedaluwarsa atau sudah dicabut. Hubungkan kembali kanal YouTube.",
    );
  if (response.status === 429 || response.status >= 500)
    throw new YoutubeOAuthError(
      "Google sedang membatasi permintaan atau mengalami gangguan. Coba kembali.",
      true,
    );
  throw new YoutubeOAuthError(
    "Google menolak permintaan YouTube. Periksa izin akun dan aktivasi YouTube Data API v3.",
  );
}

async function exchange(fields: Record<string, string>) {
  const result = tokenResponse.safeParse(
    await googleJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  );
  if (!result.success)
    throw new YoutubeOAuthError(
      "Respons token Google tidak lengkap. Hubungkan kembali YouTube.",
    );
  return result.data;
}

export async function detectYoutubeChannel(token: string) {
  const result = channelsResponse.safeParse(
    await googleJson(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=2",
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  );
  if (!result.success)
    throw new YoutubeOAuthError(
      "Identitas kanal tidak dapat dibaca dari YouTube.",
    );
  if (!result.data.items.length)
    throw new YoutubeOAuthError(
      "Akun Google ini belum memiliki kanal YouTube. Pilih akun yang memiliki kanal.",
    );
  if (result.data.items.length !== 1 || result.data.nextPageToken)
    throw new YoutubeOAuthError(
      "Google mengembalikan beberapa kanal. Hubungkan ulang dan pilih kanal tujuan saat memberi izin di Google.",
    );
  const [channel] = result.data.items;
  return { externalId: channel.id, label: channel.snippet.title };
}

export async function finishYoutubeOAuth(entry: Pending, code: string) {
  const tokens = await exchange({
    client_id: entry.clientId,
    client_secret: entry.clientSecret,
    redirect_uri: entry.redirectUri,
    code,
    code_verifier: entry.verifier,
    grant_type: "authorization_code",
  });
  const granted = new Set(tokens.scope?.split(/\s+/));
  if (!scopes.every((scope) => granted.has(scope)))
    throw new YoutubeOAuthError(
      "Izin upload dan baca YouTube diperlukan. Hubungkan ulang dan izinkan keduanya di Google.",
    );
  if (!tokens.refresh_token)
    throw new YoutubeOAuthError(
      "Google tidak memberikan izin akses berkelanjutan. Hubungkan kembali YouTube dan setujui akses.",
    );
  const channel = await detectYoutubeChannel(tokens.access_token);
  return {
    ...channel,
    token: JSON.stringify({
      clientId: entry.clientId,
      clientSecret: entry.clientSecret,
      refreshToken: tokens.refresh_token,
    }),
    loginType: "google" as const,
  };
}

export async function refreshYoutubeAccessToken(secret: string) {
  let stored: unknown;
  try {
    stored = JSON.parse(secret);
  } catch {
    throw new YoutubeOAuthError(
      "Kredensial YouTube tidak dapat dibaca. Hubungkan kembali kanal YouTube.",
    );
  }
  const parsed = credentialsSchema.safeParse(stored);
  if (!parsed.success)
    throw new YoutubeOAuthError(
      "Kredensial YouTube tidak lengkap. Hubungkan kembali kanal YouTube.",
    );
  const { clientId, clientSecret, refreshToken } = parsed.data;
  const tokens = await exchange({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return tokens.access_token;
}
