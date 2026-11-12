import { randomBytes } from "node:crypto";
import { AppError, httpsOrigin } from "./security";

type OAuthPlatform = "youtube" | "instagram" | "linkedin";
const lifetime = 600;

export function createOAuthSession<T>(platform: OAuthPlatform) {
  type Entry = {
    data: T;
    state: string;
    origin: string;
    expectedUpdatedAt: number | null;
    expires: number;
  };
  const pending = new Map<string, Entry>();
  const cookieName = `ruang_${platform}_oauth`;
  const cookiePattern = new RegExp(
    `(?:^|;\\s*)${cookieName}=([\\w-]{43})(?:;|$)`,
  );
  const browserKey = (request: Request) =>
    request.headers.get("cookie")?.match(cookiePattern)?.[1];
  const cookie = (key: string, age: number) =>
    `${cookieName}=${key}; Max-Age=${age}; Path=/api/accounts/${platform}; HttpOnly; SameSite=Lax${httpsOrigin() ? "; Secure" : ""}`;

  return {
    begin(request: Request, data: T, expectedUpdatedAt: number | null) {
      const previous = browserKey(request);
      if (previous) pending.delete(previous);
      const now = Date.now();
      for (const [key, value] of pending)
        if (value.expires <= now) pending.delete(key);
      if (pending.size >= 16)
        throw new AppError(
          "Terlalu banyak sesi koneksi yang menunggu. Coba kembali beberapa menit lagi.",
          429,
        );
      const key = randomBytes(32).toString("base64url");
      const state = randomBytes(32).toString("base64url");
      pending.set(key, {
        data,
        state,
        origin: request.headers.get("origin")!,
        expectedUpdatedAt,
        expires: now + lifetime * 1000,
      });
      setTimeout(() => pending.delete(key), lifetime * 1000).unref();
      return {
        state,
        headers: {
          "Set-Cookie": cookie(key, lifetime),
          "Cache-Control": "no-store",
        },
      };
    },
    take(request: Request) {
      const key = browserKey(request);
      const entry = key ? pending.get(key) : undefined;
      const url = new URL(request.url);
      const host = request.headers.get("host") ?? url.host;
      const origin = httpsOrigin() ?? new URL(`http://${host}`).origin;
      if (
        !key ||
        !entry ||
        entry.expires <= Date.now() ||
        entry.origin !== origin ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== entry.state
      )
        return null;
      pending.delete(key);
      return entry;
    },
    result(message: string, ok: boolean, clear: boolean) {
      const query = new URLSearchParams({
        [`${platform}_oauth`]: ok ? "connected" : "error",
        [`${platform}_message`]: message,
      });
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/?${query}`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          ...(clear ? { "Set-Cookie": cookie("", 0) } : {}),
        },
      });
    },
  };
}
