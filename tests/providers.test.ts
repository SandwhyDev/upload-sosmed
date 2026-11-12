import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { providerRequest, ProviderError } from "../src/server/providers";
test("publish transport timeout is uncertain and cannot be blindly retried", async () => {
  const stub = mock.method(globalThis, "fetch", async () => {
    throw new Error("timeout");
  });
  try {
    await assert.rejects(
      () =>
        providerRequest(
          "https://graph.facebook.com/v27.0/123/feed",
          { method: "POST" },
          true,
        ),
      (error: unknown) => error instanceof ProviderError && error.uncertain,
    );
  } finally {
    stub.mock.restore();
  }
});
test("explicit rate-limit rejection is safe to retry", async () => {
  const stub = mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 429 }),
  );
  try {
    await assert.rejects(
      () =>
        providerRequest(
          "https://graph.facebook.com/v27.0/123/feed",
          { method: "POST" },
          true,
        ),
      (error: unknown) =>
        error instanceof ProviderError && !error.uncertain && error.retryable,
    );
  } finally {
    stub.mock.restore();
  }
});
test("server error after publish request has unknown outcome", async () => {
  const stub = mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 503 }),
  );
  try {
    await assert.rejects(
      () =>
        providerRequest(
          "https://api.linkedin.com/rest/posts",
          { method: "POST" },
          true,
        ),
      (error: unknown) => error instanceof ProviderError && error.uncertain,
    );
  } finally {
    stub.mock.restore();
  }
});
test("provider token cannot be sent to an arbitrary upload host", async () => {
  const stub = mock.method(globalThis, "fetch", async () => new Response("{}"));
  try {
    await assert.rejects(() =>
      providerRequest("https://example.invalid/upload", {
        headers: { Authorization: "Bearer test-only" },
      }),
    );
    assert.equal(stub.mock.callCount(), 0);
  } finally {
    stub.mock.restore();
  }
});
