import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pg from "pg";

test(
  "isolated PostgreSQL: review version, token masking, atomic publish dedupe and safe retry",
  { timeout: 300000 },
  async () => {
    const url = new URL(
      process.env.DATABASE_URL ||
        "postgresql://ruang:ruang-local@127.0.0.1:55432/ruang_konten",
    );
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({
      connectionString: adminUrl.toString(),
      connectionTimeoutMillis: 5000,
    });
    await admin.connect();
    const name = "ruang_test_" + Date.now();
    url.pathname = "/" + name;
    await admin.query(`CREATE DATABASE "${name}"`);
    let disconnect: (() => Promise<void>) | undefined;
    try {
      process.env.DATABASE_URL = url.toString();
      await promisify(execFile)(
        process.execPath,
        ["node_modules/prisma/build/index.js", "db", "push"],
        {
          env: {
            ...process.env,
            CHECKPOINT_DISABLE: "1",
            PRISMA_HIDE_UPDATE_MESSAGE: "1",
          },
          timeout: 180000,
          windowsHide: true,
        },
      );
      const { handleApi } = await import("../src/server/api");
      const { db } = await import("../src/server/db");
      disconnect = () => db.$disconnect();
      const request = async (path: string, method = "GET", body?: unknown) => {
        const response = await handleApi(
          new Request("http://127.0.0.1:3000/api/" + path, {
            method,
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "x-ruang-request": "1",
              "content-type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          path.split("/"),
        );
        return { status: response.status, data: await response.json() };
      };
      const token = "TEST_ONLY_NOT_A_REAL_ACCESS_TOKEN";
      const pageToken = "TEST_ONLY_DERIVED_PAGE_TOKEN";
      const discoveryFetch = globalThis.fetch;
      globalThis.fetch = async (url) =>
        String(url).includes("/me?")
          ? new Response(null, { status: 400 })
          : Response.json({
              data: [
                {
                  id: "123456",
                  name: "Detected Page",
                  access_token: pageToken,
                },
                {
                  id: "567890",
                  name: "Second Page",
                  access_token: pageToken + "2",
                },
              ],
            });
      try {
        const discovered = await request("accounts/facebook/discover", "POST", {
          token,
        });
        assert.equal(discovered.status, 200);
        assert.equal(discovered.data.accounts.length, 2);
        assert.ok(!JSON.stringify(discovered.data).includes(token));
        assert.ok(!JSON.stringify(discovered.data).includes(pageToken));
        assert.equal(
          await db.account.count(),
          0,
          "discovery must not save or replace an account",
        );
        assert.equal(
          (await request("accounts/facebook/connect", "POST", { token }))
            .status,
          400,
          "selection is required",
        );
        assert.equal(
          (
            await request("accounts/facebook/connect", "POST", {
              token,
              externalId: "999999",
            })
          ).status,
          400,
          "forged identity is rejected",
        );
        assert.equal(await db.account.count(), 0);
        const connected = await request("accounts/facebook/connect", "POST", {
          token,
          externalId: "567890",
        });
        assert.equal(connected.status, 200);
        assert.equal(connected.data.label, "Second Page");
        assert.equal(connected.data.status, "CONNECTED");
        assert.ok(connected.data.checkedAt);
        assert.ok(!JSON.stringify(connected.data).includes(pageToken));
        const stored = await db.account.findUniqueOrThrow({
          where: { platform: "facebook" },
        });
        const { decryptToken } = await import("../src/server/security");
        assert.equal(await decryptToken(stored.secret), pageToken + "2");
        globalThis.fetch = async () => new Response(null, { status: 401 });
        assert.equal(
          (
            await request("accounts/facebook/connect", "POST", {
              token,
              externalId: "567890",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await db.account.findUniqueOrThrow({
              where: { platform: "facebook" },
            })
          ).updatedAt.getTime(),
          stored.updatedAt.getTime(),
          "failed detection must preserve the existing account",
        );
      } finally {
        globalThis.fetch = discoveryFetch;
      }
      const account = await request("accounts/facebook", "PUT", {
        label: "Test Page",
        externalId: "123456",
        token,
        loginType: "facebook",
      });
      assert.equal(account.status, 200);
      assert.equal(account.data.status, "UNVERIFIED");
      assert.ok(!JSON.stringify(account.data).includes(token));
      assert.ok(!("secret" in account.data));
      const encrypted = await db.account.findUniqueOrThrow({
        where: { platform: "facebook" },
      });
      assert.notEqual(encrypted.secret, token);
      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = async () =>
        Response.json({ id: "123456", name: "Isolated test Page" });
      try {
        const checked = await request("accounts/facebook/check", "POST");
        assert.equal(checked.data.status, "CONNECTED");
      } finally {
        globalThis.fetch = fetchOriginal;
      }
      const input = {
        title: "Isolated test content",
        caption: "Test caption",
        platforms: ["facebook"],
        variants: {},
        mediaId: null,
        youtube: {
          title: "",
          categoryId: "22",
          privacy: "private",
          madeForKids: "",
          synthetic: "",
        },
      };
      const created = await request("drafts", "POST", input);
      assert.equal(created.status, 201);
      const id = created.data.id;
      const oldReview = await request("review", "POST", {
        draftId: id,
        version: 1,
      });
      assert.ok(oldReview.data.reviewId);
      const changed = await request("drafts/" + id, "PUT", {
        expectedVersion: 1,
        draft: { ...input, caption: "Changed caption" },
      });
      assert.equal(changed.data.version, 2);
      const stale = await request("publish", "POST", {
        reviewId: oldReview.data.reviewId,
        acknowledgedWarnings: true,
      });
      assert.equal(stale.status, 409);
      const reviewed = await request("review", "POST", {
        draftId: id,
        version: 2,
      });
      assert.ok(reviewed.data.reviewId);
      const [first, duplicate] = await Promise.all([
        request("publish", "POST", {
          reviewId: reviewed.data.reviewId,
          acknowledgedWarnings: true,
        }),
        request("publish", "POST", {
          reviewId: reviewed.data.reviewId,
          acknowledgedWarnings: true,
        }),
      ]);
      assert.ok([200, 201].includes(first.status));
      assert.ok([200, 201].includes(duplicate.status));
      assert.equal(first.data.id, duplicate.data.id);
      assert.equal(await db.batch.count(), 1);
      assert.equal(await db.publicationJob.count(), 1);
      const blockedAccount = await request("accounts/facebook", "PUT", {
        label: "Other Page",
        externalId: "567890",
        token,
        loginType: "facebook",
      });
      assert.equal(blockedAccount.status, 409);
      globalThis.fetch = async () =>
        Response.json({
          id: "567890",
          name: "Other Page",
          category: "Website",
        });
      try {
        assert.equal(
          (
            await request("accounts/facebook/connect", "POST", {
              token,
              externalId: "567890",
            })
          ).status,
          409,
          "automatic connection also respects active jobs",
        );
      } finally {
        globalThis.fetch = fetchOriginal;
      }
      const job = await db.publicationJob.findFirstOrThrow();
      await db.publicationJob.update({
        where: { id: job.id },
        data: { state: "NEEDS_CHECK" },
      });
      assert.equal(
        (await request("jobs/" + job.id + "/retry", "POST")).status,
        409,
      );
      await db.publicationJob.update({
        where: { id: job.id },
        data: { state: "FAILED", message: "Explicit rejection" },
      });
      assert.equal(
        (await request("jobs/" + job.id + "/retry", "POST")).status,
        200,
      );
      await db.publicationJob.update({
        where: { id: job.id },
        data: { state: "SUCCEEDED", externalId: "confirmed-test-post" },
      });
      assert.equal(
        (await request("jobs/" + job.id + "/retry", "POST")).status,
        409,
      );
      assert.equal((await request("drafts/" + id, "DELETE")).status, 409);
      const storageKeys = [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
      ];
      const originalStorage = storageKeys.map((key) => process.env[key]);
      try {
        process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
        process.env.CLOUDINARY_API_KEY = "TEST_ONLY_KEY";
        process.env.CLOUDINARY_API_SECRET = "TEST_ONLY_SECRET";
        await db.account.create({
          data: {
            platform: "instagram",
            label: "Isolated Instagram",
            externalId: "178414123",
            loginType: "instagram",
            secret: encrypted.secret,
            status: "CONNECTED",
            message: "Test identity",
          },
        });
        const image = await db.media.create({
          data: {
            name: "Test 2x3 image.jpeg",
            mime: "image/jpeg",
            size: 272449,
            width: 1024,
            height: 1536,
          },
        });
        const imageDraft = await request("drafts", "POST", {
          ...input,
          platforms: ["instagram"],
          mediaId: image.id,
        });
        const imageReview = await request("review", "POST", {
          draftId: imageDraft.data.id,
          version: 1,
        });
        assert.equal(imageReview.status, 200);
        assert.ok(
          imageReview.data.reviewId,
          "2:3 images must reach review instead of a local rejection",
        );
        assert.deepEqual(imageReview.data.issues, []);
        const beforePublish = await db.publicationJob.count();
        const confirmed = await request("publish", "POST", {
          reviewId: imageReview.data.reviewId,
          acknowledgedWarnings: false,
        });
        assert.equal(confirmed.status, 201);
        assert.equal(await db.publicationJob.count(), beforePublish + 1);
        const imageJob = await db.publicationJob.findFirstOrThrow({
          where: { platform: "instagram" },
        });
        assert.equal(imageJob.state, "QUEUED");
        const storedSnapshot = imageJob.snapshot as {
          media: { width: number; height: number };
        };
        assert.equal(storedSnapshot.media.width, 1024);
        assert.equal(storedSnapshot.media.height, 1536);
      } finally {
        storageKeys.forEach((key, index) => {
          if (originalStorage[index] === undefined) delete process.env[key];
          else process.env[key] = originalStorage[index];
        });
      }
      const origin = "http://127.0.0.1:3000";
      const clientId = "123-test.apps.googleusercontent.com";
      const clientSecret = "TEST_ONLY_GOOGLE_CLIENT_SECRET";
      const refreshToken = "TEST_ONLY_GOOGLE_REFRESH_TOKEN";
      const channelId = "UC" + "a".repeat(22);
      const oauth = await handleApi(
        new Request(origin + "/api/accounts/youtube/oauth", {
          method: "POST",
          headers: {
            origin,
            "x-ruang-request": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ clientId, clientSecret }),
        }),
        ["accounts", "youtube", "oauth"],
      );
      assert.equal(oauth.status, 200);
      const authorization = new URL((await oauth.json()).authorizationUrl);
      const cookie = oauth.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly; SameSite=Lax/);
      assert.equal(authorization.origin, "https://accounts.google.com");
      assert.equal(
        authorization.searchParams.get("redirect_uri"),
        origin + "/api/accounts/youtube/callback",
      );
      assert.equal(authorization.searchParams.get("access_type"), "offline");
      assert.equal(
        authorization.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert.ok(
        !authorization.href.includes(clientSecret) &&
          !cookie.includes(clientSecret),
      );
      const callback = (state: string, headers: Record<string, string> = {}) =>
        handleApi(
          new Request(
            origin +
              "/api/accounts/youtube/callback?" +
              new URLSearchParams({ state, code: "TEST_ONLY_CODE" }),
            {
              headers: {
                cookie: cookie.split(";")[0],
                "sec-fetch-site": "cross-site",
                ...headers,
              },
            },
          ),
          ["accounts", "youtube", "callback"],
        );
      let tokenRequests = 0;
      let channelRequests = 0;
      const oauthFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          tokenRequests++;
          const fields = init?.body as URLSearchParams;
          assert.equal(fields.get("client_secret"), clientSecret);
          if (tokenRequests === 1) {
            assert.equal(fields.get("grant_type"), "authorization_code");
            assert.equal(
              createHash("sha256")
                .update(fields.get("code_verifier")!)
                .digest("base64url"),
              authorization.searchParams.get("code_challenge"),
            );
            return Response.json({
              access_token: "TEST_ONLY_ACCESS",
              refresh_token: refreshToken,
              scope: authorization.searchParams.get("scope"),
            });
          }
          assert.equal(fields.get("grant_type"), "refresh_token");
          assert.equal(fields.get("refresh_token"), refreshToken);
          return Response.json({ access_token: "TEST_ONLY_REFRESHED_ACCESS" });
        }
        assert.match(
          String(url),
          /^https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?/,
        );
        channelRequests++;
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          channelRequests === 1
            ? "Bearer TEST_ONLY_ACCESS"
            : "Bearer TEST_ONLY_REFRESHED_ACCESS",
        );
        return Response.json({
          items: [
            { id: channelId, snippet: { title: "Test YouTube channel" } },
          ],
        });
      };
      try {
        const state = authorization.searchParams.get("state")!;
        for (const rejected of [
          await callback("wrong-state"),
          await callback(state, { cookie: "" }),
        ]) {
          assert.equal(rejected.status, 303);
          assert.match(
            rejected.headers.get("location")!,
            /youtube_oauth=error/,
          );
        }
        assert.equal(tokenRequests, 0);
        assert.equal(
          await db.account.findUnique({ where: { platform: "youtube" } }),
          null,
        );
        const completed = await callback(state);
        assert.equal(completed.status, 303);
        assert.match(
          completed.headers.get("location")!,
          /youtube_oauth=connected/,
        );
        assert.ok(!completed.headers.get("location")!.includes("TEST_ONLY"));
        assert.match(completed.headers.get("set-cookie")!, /Max-Age=0/);
        const stored = await db.account.findUniqueOrThrow({
          where: { platform: "youtube" },
        });
        assert.equal(stored.loginType, "google");
        assert.equal(stored.externalId, channelId);
        assert.equal(stored.status, "CONNECTED");
        assert.ok(!stored.secret.includes(refreshToken));
        const { decryptToken } = await import("../src/server/security");
        assert.deepEqual(JSON.parse(await decryptToken(stored.secret)), {
          clientId,
          clientSecret,
          refreshToken,
        });
        const replay = await callback(state);
        assert.match(replay.headers.get("location")!, /youtube_oauth=error/);
        assert.equal(tokenRequests, 1);
        const checked = await request("accounts/youtube/check", "POST");
        assert.equal(checked.data.status, "CONNECTED");
        assert.equal(tokenRequests, 2);
        assert.equal(channelRequests, 2);
        const invalidManual = await request("accounts/youtube", "PUT", {
          label: "Manual",
          externalId: channelId,
        });
        assert.equal(invalidManual.status, 400);
        assert.equal(
          (
            await db.account.findUniqueOrThrow({
              where: { platform: "youtube" },
            })
          ).secret,
          stored.secret,
        );
      } finally {
        globalThis.fetch = oauthFetch;
      }
      const igSettings = {
        INSTAGRAM_APP_ID: "123456789",
        INSTAGRAM_APP_SECRET: "TEST_ONLY_INSTAGRAM_APP_SECRET",
        INSTAGRAM_REDIRECT_URI:
          "https://example.invalid/instagram-callback.html",
      };
      const originalInstagramSettings = Object.fromEntries(
        Object.keys(igSettings).map((key) => [key, process.env[key]]),
      );
      const igFetch = globalThis.fetch;
      const igShortToken = "TEST_ONLY_INSTAGRAM_SHORT_TOKEN";
      const igLongToken = "TEST_ONLY_INSTAGRAM_LONG_TOKEN";
      try {
        Object.assign(process.env, igSettings);
        await db.publicationJob.updateMany({
          where: { platform: "instagram", state: "QUEUED" },
          data: { state: "CANCELED" },
        });
        const igStart = await handleApi(
          new Request(origin + "/api/accounts/instagram/oauth", {
            method: "POST",
            headers: { origin, "x-ruang-request": "1" },
          }),
          ["accounts", "instagram", "oauth"],
        );
        assert.equal(igStart.status, 200);
        const authorize = new URL((await igStart.json()).authorizationUrl);
        assert.equal(authorize.origin, "https://www.instagram.com");
        assert.equal(
          authorize.searchParams.get("redirect_uri"),
          igSettings.INSTAGRAM_REDIRECT_URI,
        );
        assert.equal(
          authorize.searchParams.get("scope"),
          "instagram_business_basic,instagram_business_content_publish",
        );
        assert.ok(!authorize.href.includes(igSettings.INSTAGRAM_APP_SECRET));
        const igCookie = igStart.headers.get("set-cookie")!.split(";")[0];
        const igState = authorize.searchParams.get("state")!;
        const igCallback = (state: string, cookie = igCookie) =>
          handleApi(
            new Request(
              origin +
                "/api/accounts/instagram/callback?" +
                new URLSearchParams({ state, code: "TEST_ONLY_IG_CODE" }),
              { headers: { cookie, "sec-fetch-site": "cross-site" } },
            ),
            ["accounts", "instagram", "callback"],
          );
        let igRequests = 0;
        globalThis.fetch = async (url, init) => {
          const target = new URL(String(url));
          igRequests++;
          if (igRequests === 1) {
            assert.equal(
              target.href,
              "https://api.instagram.com/oauth/access_token",
            );
            const fields = init?.body as URLSearchParams;
            assert.equal(
              fields.get("redirect_uri"),
              igSettings.INSTAGRAM_REDIRECT_URI,
            );
            assert.equal(
              fields.get("client_secret"),
              igSettings.INSTAGRAM_APP_SECRET,
            );
            assert.equal(fields.get("code"), "TEST_ONLY_IG_CODE");
            return Response.json({ data: [{ access_token: igShortToken }] });
          }
          if (igRequests === 2) {
            assert.equal(
              target.origin + target.pathname,
              "https://graph.instagram.com/access_token",
            );
            assert.equal(
              target.searchParams.get("grant_type"),
              "ig_exchange_token",
            );
            assert.equal(target.searchParams.get("access_token"), igShortToken);
            return Response.json({ access_token: igLongToken });
          }
          assert.equal(target.hostname, "graph.instagram.com");
          assert.ok(target.pathname.endsWith("/me"));
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            `Bearer ${igLongToken}`,
          );
          return Response.json({
            user_id: "178414456",
            username: "test_ig_oauth",
          });
        };
        assert.match(
          (await igCallback("incorrect")).headers.get("location")!,
          /instagram_oauth=error/,
        );
        assert.match(
          (await igCallback(igState, "")).headers.get("location")!,
          /instagram_oauth=error/,
        );
        assert.equal(igRequests, 0);
        const igConnected = await igCallback(igState);
        assert.equal(igConnected.status, 303);
        assert.match(
          igConnected.headers.get("location")!,
          /instagram_oauth=connected/,
        );
        assert.ok(!igConnected.headers.get("location")!.includes("TEST_ONLY"));
        assert.equal(igRequests, 3);
        const igStored = await db.account.findUniqueOrThrow({
          where: { platform: "instagram" },
        });
        const { decryptToken } = await import("../src/server/security");
        assert.equal(igStored.externalId, "178414456");
        assert.equal(igStored.loginType, "instagram");
        assert.equal(igStored.status, "CONNECTED");
        assert.equal(await decryptToken(igStored.secret), igLongToken);
        assert.match(
          (await igCallback(igState)).headers.get("location")!,
          /instagram_oauth=error/,
        );
        assert.equal(igRequests, 3);
      } finally {
        globalThis.fetch = igFetch;
        for (const [key, value] of Object.entries(originalInstagramSettings)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      const state = await request("state");
      assert.ok(!JSON.stringify(state.data).includes(igLongToken));
      assert.ok(!JSON.stringify(state.data).includes(refreshToken));
      assert.ok(!JSON.stringify(state.data).includes(clientSecret));
      assert.ok(!JSON.stringify(state.data).includes(token));
      assert.ok(!JSON.stringify(state.data).includes(encrypted.secret));
    } finally {
      await disconnect?.();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  },
);
