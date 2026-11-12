import { test, mock, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import {
  uploadToCloudinary,
  CloudinaryUploadError,
} from "../src/server/cloudinary";
import {
  hasRemoteStorage,
  remoteStorageName,
  mediaPath,
} from "../src/server/media";
import {
  publishToPlatform,
  ProviderError,
  type PublishContext,
} from "../src/server/providers";
import { encryptToken } from "../src/server/security";
import { newDraft, type MediaInfo, type Snapshot } from "../src/lib/domain";
import type { Account } from "../src/generated/prisma/client";

const keys = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const saved = keys.map((key) => process.env[key]);
const files: string[] = [];
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "123456789";
  process.env.CLOUDINARY_API_SECRET = "TEST_ONLY_CLOUDINARY_SECRET";
});
afterEach(() =>
  keys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  }),
);
after(async () => {
  for (const file of files) await unlink(file);
});

async function fixture(mime = "image/jpeg", size = 12): Promise<MediaInfo> {
  const media: MediaInfo = {
    id: randomUUID(),
    name: "Test media",
    mime,
    size,
    width: 1080,
    height: 1920,
    duration: mime === "video/mp4" ? 10 : null,
  };
  await mkdir(".data/media", { recursive: true });
  const file = mediaPath(media.id);
  await writeFile(file, new Uint8Array(size), { flag: "wx" });
  files.push(file);
  return media;
}
function uploaded(media: MediaInfo, extra: Record<string, unknown> = {}) {
  const type = media.mime === "video/mp4" ? "video" : "image";
  return {
    secure_url: `https://res.cloudinary.com/test-cloud/${type}/upload/v1/ruang-konten/${media.id}.${type === "video" ? "mp4" : "jpg"}`,
    public_id: `ruang-konten/${media.id}`,
    resource_type: type,
    ...extra,
  };
}
async function account(): Promise<Account> {
  return {
    platform: "instagram",
    label: "Test studio",
    externalId: "178414123",
    loginType: "instagram",
    secret: await encryptToken("TEST_ONLY_INSTAGRAM_TOKEN"),
    status: "CONNECTED",
    message: "Test",
    checkedAt: new Date(),
    updatedAt: new Date(),
  };
}
function snapshot(media: MediaInfo): Snapshot {
  return {
    ...newDraft(),
    title: "Test",
    platforms: ["instagram"],
    mediaId: media.id,
    media,
    accounts: [],
  };
}
const context: PublishContext = {
  checkpoint: async () => {},
  processing: async () => {},
};

test("Cloudinary configuration enables remote storage and takes priority over R2", () => {
  process.env.R2_ENDPOINT = "https://example.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "test-bucket";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  assert.equal(remoteStorageName(), "Cloudinary");
  assert.equal(hasRemoteStorage(), true);
  delete process.env.CLOUDINARY_API_SECRET;
  assert.equal(remoteStorageName(), "R2");
  delete process.env.R2_BUCKET;
  assert.equal(hasRemoteStorage(), false);
});

test("image upload sends signed fields and returns the provider HTTPS URL", async () => {
  const media = await fixture();
  const stub = mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      assert.equal(
        url,
        "https://api.cloudinary.com/v1_1/test-cloud/image/upload",
      );
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.ok(init.body instanceof FormData);
      const body = init.body;
      const signed = `overwrite=true&public_id=ruang-konten/${media.id}&timestamp=${body.get("timestamp")}&type=upload`;
      assert.equal(
        body.get("signature"),
        createHash("sha256")
          .update(signed + process.env.CLOUDINARY_API_SECRET)
          .digest("hex"),
      );
      assert.equal(body.get("api_key"), "123456789");
      assert.equal(body.get("api_secret"), null);
      assert.equal((body.get("file") as Blob).size, media.size);
      assert.ok(!url.includes("TEST_ONLY"));
      return Response.json(uploaded(media));
    },
  );
  try {
    assert.equal(
      await uploadToCloudinary(media, mediaPath(media.id)),
      uploaded(media).secure_url,
    );
  } finally {
    stub.mock.restore();
  }
});

test("large video upload sends ordered chunks with one upload ID and awaits the final response", async () => {
  const chunkSize = 20 * 1024 * 1024;
  const media = await fixture("video/mp4", chunkSize + 3);
  let uploadId: string | null = null;
  let calls = 0;
  const stub = mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      assert.ok(url.endsWith("/video/upload"));
      const headers = new Headers(init.headers);
      assert.equal(
        headers.get("content-range"),
        calls === 0
          ? `bytes 0-${chunkSize - 1}/${media.size}`
          : `bytes ${chunkSize}-${chunkSize + 2}/${media.size}`,
      );
      if (calls === 0) uploadId = headers.get("x-unique-upload-id");
      else assert.equal(headers.get("x-unique-upload-id"), uploadId);
      assert.ok(uploadId);
      assert.equal(
        ((init.body as FormData).get("file") as Blob).size,
        calls === 0 ? chunkSize : 3,
      );
      calls++;
      return Response.json(
        calls === 1 ? { done: false } : uploaded(media, { done: true }),
      );
    },
  );
  try {
    assert.equal(
      await uploadToCloudinary(media, mediaPath(media.id)),
      uploaded(media).secure_url,
    );
    assert.equal(calls, 2);
  } finally {
    stub.mock.restore();
  }
});

test("missing credentials and an invalid cloud name stop before any network call", async () => {
  const media = await fixture();
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json(uploaded(media)),
  );
  try {
    delete process.env.CLOUDINARY_API_SECRET;
    await assert.rejects(
      () => uploadToCloudinary(media, mediaPath(media.id)),
      CloudinaryUploadError,
    );
    process.env.CLOUDINARY_API_SECRET = "TEST_ONLY_SECRET";
    process.env.CLOUDINARY_CLOUD_NAME = "attacker.invalid/path";
    await assert.rejects(
      () => uploadToCloudinary(media, mediaPath(media.id)),
      CloudinaryUploadError,
    );
    assert.equal(stub.mock.callCount(), 0);
  } finally {
    stub.mock.restore();
  }
});

test("changed local files are rejected before upload", async () => {
  const media = await fixture();
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json(uploaded(media)),
  );
  try {
    await assert.rejects(
      () =>
        uploadToCloudinary(
          { ...media, size: media.size + 1 },
          mediaPath(media.id),
        ),
      /Ukuran file lokal/,
    );
    assert.equal(stub.mock.callCount(), 0);
  } finally {
    stub.mock.restore();
  }
});

test("invalid Cloudinary results never become an Instagram media URL", async () => {
  const media = await fixture();
  for (const result of [
    {},
    uploaded(media, { done: false }),
    uploaded(media, {
      secure_url: "http://res.cloudinary.com/test-cloud/image/upload/x.jpg",
    }),
    uploaded(media, { secure_url: "https://attacker.invalid/media.jpg" }),
    uploaded(media, {
      secure_url: "https://res.cloudinary.com/another-cloud/image/upload/x.jpg",
    }),
    uploaded(media, { public_id: "another-media" }),
    uploaded(media, { resource_type: "video" }),
  ]) {
    const stub = mock.method(globalThis, "fetch", async () =>
      Response.json(result),
    );
    try {
      await assert.rejects(
        () => uploadToCloudinary(media, mediaPath(media.id)),
        CloudinaryUploadError,
      );
    } finally {
      stub.mock.restore();
    }
  }
});

test("Instagram receives image_url or video_url only after Cloudinary has completed", async () => {
  for (const mime of ["image/jpeg", "video/mp4"]) {
    const media = await fixture(mime);
    const owner = await account();
    const calls: string[] = [];
    const stub = mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        if (url.includes("api.cloudinary.com")) {
          calls.push("cloudinary");
          assert.ok(!JSON.stringify(init.headers).includes("INSTAGRAM_TOKEN"));
          return Response.json(uploaded(media));
        }
        assert.deepEqual(calls.slice(0, 1), ["cloudinary"]);
        assert.ok(!url.includes("CLOUDINARY_SECRET"));
        if (url.endsWith("/178414123/media")) {
          calls.push("container");
          const fields = init.body as URLSearchParams;
          assert.equal(
            fields.get(mime === "video/mp4" ? "video_url" : "image_url"),
            uploaded(media).secure_url,
          );
          return Response.json({ id: "container-123" });
        }
        if (url.includes("fields=status_code"))
          return Response.json({ status_code: "FINISHED" });
        if (url.endsWith("/media_publish")) {
          calls.push("publish");
          return Response.json({ id: "post-123" });
        }
        return Response.json({
          permalink: "https://www.instagram.com/p/test/",
        });
      },
    );
    try {
      assert.equal(
        (await publishToPlatform("instagram", owner, snapshot(media), context))
          .id,
        "post-123",
      );
      assert.deepEqual(calls, ["cloudinary", "container", "publish"]);
    } finally {
      stub.mock.restore();
    }
  }
});

test("Cloudinary rejection or transport failure stops Instagram and preserves safe retry classification", async () => {
  const media = await fixture();
  const owner = await account();
  for (const status of [401, 413, 429, 503, 0]) {
    const stub = mock.method(globalThis, "fetch", async (url: string) => {
      assert.ok(url.startsWith("https://api.cloudinary.com/"));
      if (!status) throw new Error("TEST_ONLY_SECRET_IN_TRANSPORT");
      return new Response("TEST_ONLY_SECRET_IN_RESPONSE", { status });
    });
    try {
      await assert.rejects(
        () => publishToPlatform("instagram", owner, snapshot(media), context),
        (error: unknown) =>
          error instanceof ProviderError &&
          !error.uncertain &&
          error.retryable ===
            (status === 0 || status === 429 || status >= 500) &&
          !error.message.includes("TEST_ONLY"),
      );
      assert.equal(stub.mock.callCount(), 1);
    } finally {
      stub.mock.restore();
    }
  }
});
