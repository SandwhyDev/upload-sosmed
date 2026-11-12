import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchStatus,
  captionFor,
  draftSchema,
  newDraft,
  validateContent,
  type AccountInfo,
  type DraftInput,
  type MediaInfo,
} from "../src/lib/domain";
const media: MediaInfo = {
  id: "a379678b-43b9-4ddd-86c3-e8162a4d0dfb",
  name: "reel.mp4",
  mime: "video/mp4",
  size: 1000000,
  width: 1080,
  height: 1920,
  duration: 24,
  codec: "h264",
};
const accounts: AccountInfo[] = [
  "instagram",
  "facebook",
  "youtube",
  "linkedin",
].map((platform) => ({
  platform,
  label: platform,
  externalId: "123",
  loginType: "facebook",
  status: "CONNECTED",
  message: "",
  checkedAt: null,
  updatedAt: "",
  hasToken: true,
})) as AccountInfo[];
function draft(value: Partial<DraftInput> = {}): DraftInput {
  return {
    ...newDraft(),
    title: "Cerita produk",
    caption: "Cerita hari ini",
    platforms: ["facebook"],
    ...value,
  };
}
test("draft can omit all platform caption overrides", () => {
  assert.equal(draftSchema.parse(draft()).title, "Cerita produk");
});
test("platform override preserves the common caption and other platforms", () => {
  const d = draft({ variants: { linkedin: "Teks profesional" } });
  assert.equal(captionFor(d, "linkedin"), "Teks profesional");
  assert.equal(captionFor(d, "facebook"), "Cerita hari ini");
});
test("intentionally empty override remains empty", () => {
  assert.equal(
    captionFor(draft({ variants: { linkedin: "" } }), "linkedin"),
    "",
  );
});
test("duplicate destinations are rejected", () => {
  assert.equal(
    draftSchema.safeParse(draft({ platforms: ["facebook", "facebook"] }))
      .success,
    false,
  );
});
test("server-owned status fields cannot be supplied in draft", () => {
  assert.equal(
    draftSchema.safeParse({ ...draft(), status: "APPROVED" }).success,
    false,
  );
});
test("Facebook text post is valid without media", () => {
  assert.deepEqual(validateContent(draft(), null, accounts, false), []);
});
test("unconnected account blocks review", () => {
  assert.ok(
    validateContent(draft(), null, [], false).some(
      (i) => i.severity === "error",
    ),
  );
});
test("YouTube rejects text without video and missing metadata", () => {
  const issues = validateContent(
    draft({ platforms: ["youtube"] }),
    null,
    accounts,
    false,
  );
  assert.ok(issues.some((i) => i.message.includes("MP4")));
  assert.ok(issues.some((i) => i.message.includes("anak-anak")));
});
test("YouTube video with explicit metadata can be reviewed", () => {
  const d = draft({
    platforms: ["youtube"],
    youtube: {
      title: "Judul video",
      categoryId: "22",
      privacy: "private",
      madeForKids: "no",
      synthetic: "no",
    },
  });
  assert.deepEqual(validateContent(d, media, accounts, false), []);
});
test("Instagram local media cannot be sent as a public URL", () => {
  assert.ok(
    validateContent(
      draft({ platforms: ["instagram"] }),
      media,
      accounts,
      false,
    ).some((i) => i.message.includes("R2")),
  );
});
test("Instagram vertical video can be reviewed with remote storage", () => {
  assert.deepEqual(
    validateContent(draft({ platforms: ["instagram"] }), media, accounts, true),
    [],
  );
});
test("Instagram PNG and long captions block publishing", () => {
  const issues = validateContent(
    draft({ platforms: ["instagram"], caption: "x".repeat(2201) }),
    { ...media, mime: "image/png" },
    accounts,
    true,
  );
  assert.equal(issues.filter((i) => i.severity === "error").length, 2);
});

test("Instagram 1024x1536 image reaches review without a local ratio warning", () => {
  const image = {
    ...media,
    mime: "image/jpeg",
    width: 1024,
    height: 1536,
    duration: null,
  };
  const issues = validateContent(
    draft({ platforms: ["instagram"] }),
    image,
    accounts,
    true,
  );
  assert.deepEqual(issues, []);
});

test("Instagram image ratios are left to the platform without local warnings", () => {
  for (const [width, height] of [
    [1080, 1350],
    [1910, 1000],
    [1080, 1080],
    [2400, 1000],
    [1080, 1920],
  ]) {
    const issues = validateContent(
      draft({ platforms: ["instagram"] }),
      { ...media, mime: "image/jpeg", width, height, duration: null },
      accounts,
      true,
    );
    assert.deepEqual(issues, []);
  }
});
test("unknown result takes precedence over partial success", () => {
  assert.equal(
    batchStatus([{ state: "SUCCEEDED" }, { state: "NEEDS_CHECK" }]),
    "Perlu dicek",
  );
});
test("mixed outcomes retain partial failure", () => {
  assert.equal(
    batchStatus([{ state: "SUCCEEDED" }, { state: "FAILED" }]),
    "Sebagian berhasil",
  );
});
test("active jobs remain in progress", () => {
  assert.equal(
    batchStatus([{ state: "SUCCEEDED" }, { state: "PROCESSING" }]),
    "Dalam proses",
  );
});
