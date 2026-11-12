import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalRequest,
  encryptToken,
  decryptToken,
} from "../src/server/security";
const origin = "http://127.0.0.1:3000";
function request(headers: Record<string, string> = {}, method = "POST") {
  return new Request(origin + "/api/drafts", {
    method,
    headers: {
      host: "127.0.0.1:3000",
      origin,
      "x-ruang-request": "1",
      ...headers,
    },
  });
}
test("same origin local mutations accepted", () =>
  assert.doesNotThrow(() => assertLocalRequest(request())));
test("cross site origin rejected", () =>
  assert.throws(() =>
    assertLocalRequest(request({ origin: "https://evil.example" })),
  ));
test("cross-site fetch metadata rejected even when origin is spoofed", () =>
  assert.throws(() =>
    assertLocalRequest(request({ "sec-fetch-site": "cross-site" })),
  ));
test("missing intent header rejected", () =>
  assert.throws(() => assertLocalRequest(request({ "x-ruang-request": "" }))));
test("missing origin rejected on writes", () =>
  assert.throws(() => assertLocalRequest(request({ origin: "" }))));
test("untrusted host rejected for DNS rebinding protection", () =>
  assert.throws(() =>
    assertLocalRequest(request({ host: "evil.example:3000" })),
  ));
test("local reads do not require mutation headers", () =>
  assert.doesNotThrow(() =>
    assertLocalRequest(
      new Request(origin + "/api/state", {
        headers: { host: "127.0.0.1:3000" },
      }),
    ),
  ));
test("token encrypted at rest can be decrypted without exposing plaintext", async () => {
  const token = "test-only-not-a-real-platform-token";
  const sealed = await encryptToken(token);
  assert.ok(!sealed.includes(token));
  assert.equal(await decryptToken(sealed), token);
  const other = await encryptToken(token);
  assert.notEqual(sealed, other);
});
test("modified encrypted token is rejected", async () => {
  const sealed = await encryptToken("test-only");
  const bytes = Buffer.from(sealed, "base64");
  bytes[15] ^= 1;
  await assert.rejects(() => decryptToken(bytes.toString("base64")));
});
