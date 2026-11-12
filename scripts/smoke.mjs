import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
const request = async (path, method = "GET", body) => {
  const response = await fetch(origin + "/api/" + path, {
    method,
    headers: {
      Origin: origin,
      "X-Ruang-Request": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `${method} ${path}: HTTP ${response.status}, non-JSON response`,
    );
  }
  return { status: response.status, data };
};
let draftId, mediaId, videoId;
try {
  const state = await request("state");
  assert.equal(state.status, 200);
  assert.ok(!JSON.stringify(state.data.accounts).includes("secret"));
  const jpeg = await sharp({
    create: { width: 100, height: 125, channels: 3, background: "#42454f" },
  })
    .jpeg()
    .toBuffer();
  const uploaded = await fetch(origin + "/api/media", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Ruang-Request": "1",
      "Content-Type": "image/jpeg",
      "X-File-Name": "smoke-test.jpg",
    },
    body: jpeg,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(uploaded.status, 201);
  const media = await uploaded.json();
  mediaId = media.id;
  assert.equal(media.width, 100);
  assert.equal(media.height, 125);
  const draft = {
    title: "Uji otomatis sementara",
    caption: "Konten uji lokal. Tidak dikirim ke platform.",
    platforms: ["facebook"],
    mediaId,
    variants: { linkedin: "Variasi uji" },
    youtube: {
      title: "",
      categoryId: "22",
      privacy: "private",
      madeForKids: "",
      synthetic: "",
    },
  };
  const created = await request("drafts", "POST", draft);
  assert.equal(created.status, 201);
  draftId = created.data.id;
  const saved = await request("drafts/" + draftId, "PUT", {
    expectedVersion: 1,
    draft: { ...draft, caption: "Revisi konten uji" },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.version, 2);
  const stale = await request("drafts/" + draftId, "PUT", {
    expectedVersion: 1,
    draft,
  });
  assert.equal(stale.status, 409);
  const staleReview = await request("review", "POST", { draftId, version: 1 });
  assert.equal(staleReview.status, 409);
  const review = await request("review", "POST", { draftId, version: 2 });
  assert.equal(review.status, 200);
  if (
    !state.data.accounts.some(
      (a) => a.platform === "facebook" && a.status === "CONNECTED",
    )
  ) {
    assert.equal(review.data.reviewId, null);
    assert.ok(review.data.issues.some((i) => i.severity === "error"));
  }
  const blockedDelete = await request("media/" + mediaId, "DELETE");
  assert.equal(blockedDelete.status, 409);
  const range = await fetch(origin + "/api/media/" + mediaId, {
    headers: { Range: "bytes=0-15" },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  if (process.env.VIDEO_FIXTURE) {
    const video = await readFile(process.env.VIDEO_FIXTURE);
    const response = await fetch(origin + "/api/media", {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Ruang-Request": "1",
        "Content-Type": "video/mp4",
        "X-File-Name": "smoke-video.mp4",
      },
      body: video,
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 201, await response.clone().text());
    const info = await response.json();
    videoId = info.id;
    assert.ok(info.duration > 0);
    assert.ok(info.width > 0);
    assert.ok(info.codec);
    const bytes = await fetch(origin + "/api/media/" + videoId, {
      headers: { Range: "bytes=0-255" },
    });
    assert.equal(bytes.status, 206);
    assert.equal((await bytes.arrayBuffer()).byteLength, 256);
    console.log(
      "PASS: real MP4 upload, FFprobe duration/dimensions/codec, and video range playback.",
    );
  }
  const csrf = await fetch(origin + "/api/drafts", {
    method: "POST",
    headers: {
      Origin: "https://example.invalid",
      "X-Ruang-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draft),
  });
  assert.equal(csrf.status, 403);
  console.log(
    "PASS: state, real JPEG upload, metadata, draft persistence, optimistic version, stale review, missing-account blocker, referenced-media protection, video/image byte range, and cross-origin rejection.",
  );
} finally {
  if (draftId) await request("drafts/" + draftId, "DELETE").catch(() => {});
  if (mediaId) await request("media/" + mediaId, "DELETE").catch(() => {});
  if (videoId) await request("media/" + videoId, "DELETE").catch(() => {});
}
