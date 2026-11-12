import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  discoverMetaAccounts,
  publicMetaChoices,
} from "../src/server/meta-accounts";
import { ProviderError } from "../src/server/providers";

const token = "TEST_ONLY_INPUT_TOKEN";
const pageToken = "TEST_ONLY_PAGE_TOKEN";

test("Instagram Login resolves professional user_id and never exposes the token in choices", async () => {
  const stub = mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      const target = new URL(url);
      assert.equal(target.hostname, "graph.instagram.com");
      assert.equal(target.searchParams.get("fields"), "user_id,username");
      assert.equal(
        new Headers(init.headers).get("authorization"),
        `Bearer ${token}`,
      );
      assert.ok(!url.includes(token));
      return Response.json({
        id: "999",
        user_id: "178414123",
        username: "teststudio",
      });
    },
  );
  try {
    const accounts = await discoverMetaAccounts("instagram", token);
    assert.deepEqual(publicMetaChoices(accounts), [
      { externalId: "178414123", label: "@teststudio", loginType: "instagram" },
    ]);
    assert.equal(accounts[0].token, token);
    assert.equal(stub.mock.callCount(), 1);
  } finally {
    stub.mock.restore();
  }
});

test("Page token resolves its own Page without requesting a list", async () => {
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json({ id: "123", name: "Test Page", category: "Website" }),
  );
  try {
    const accounts = await discoverMetaAccounts("facebook", token);
    assert.equal(accounts[0].externalId, "123");
    assert.equal(accounts[0].token, token);
    assert.equal(stub.mock.callCount(), 1);
  } finally {
    stub.mock.restore();
  }
});

test("user token discovers all Pages, uses derived Page tokens, and rebuilds cursor URLs", async () => {
  const stub = mock.method(globalThis, "fetch", async (url: string) => {
    const target = new URL(url);
    assert.equal(target.hostname, "graph.facebook.com");
    assert.ok(!url.includes(token));
    if (target.pathname.endsWith("/me"))
      return new Response(null, { status: 400 });
    if (target.searchParams.has("after")) {
      assert.equal(target.searchParams.get("after"), "cursor-one");
      return Response.json({
        data: [
          { id: "456", name: "Second Page", access_token: pageToken + "2" },
        ],
      });
    }
    return Response.json({
      data: [{ id: "123", name: "First Page", access_token: pageToken }],
      paging: {
        next: "https://attacker.invalid/steal?access_token=secret",
        cursors: { after: "cursor-one" },
      },
    });
  });
  try {
    const accounts = await discoverMetaAccounts("facebook", token);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].token, pageToken);
    assert.ok(!JSON.stringify(publicMetaChoices(accounts)).includes(pageToken));
    assert.equal(stub.mock.callCount(), 3);
  } finally {
    stub.mock.restore();
  }
});

test("Facebook login resolves only linked Instagram professionals with their Page tokens", async () => {
  const stub = mock.method(globalThis, "fetch", async (url: string) => {
    const target = new URL(url);
    if (
      target.hostname === "graph.instagram.com" ||
      target.pathname.endsWith("/me")
    )
      return new Response(null, { status: 400 });
    return Response.json({
      data: [
        {
          id: "123",
          name: "Studio",
          access_token: pageToken,
          instagram_business_account: {
            id: "178414123",
            username: "teststudio",
          },
        },
        { id: "456", name: "Unlinked", access_token: pageToken },
      ],
    });
  });
  try {
    assert.deepEqual(await discoverMetaAccounts("instagram", token), [
      {
        externalId: "178414123",
        label: "@teststudio",
        loginType: "facebook",
        token: pageToken,
      },
    ]);
  } finally {
    stub.mock.restore();
  }
});

test("direct Facebook Page token can resolve a linked Instagram account", async () => {
  const stub = mock.method(globalThis, "fetch", async (url: string) =>
    url.includes("graph.instagram.com")
      ? new Response(null, { status: 400 })
      : Response.json({
          id: "123",
          name: "Studio",
          category: "Website",
          instagram_business_account: {
            id: "178414123",
            username: "teststudio",
          },
        }),
  );
  try {
    const accounts = await discoverMetaAccounts("instagram", token);
    assert.equal(accounts[0].externalId, "178414123");
    assert.equal(accounts[0].token, token);
    assert.equal(stub.mock.callCount(), 2);
  } finally {
    stub.mock.restore();
  }
});

test("rate limits and server failures stop probing immediately", async () => {
  for (const status of [429, 503]) {
    const stub = mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status }),
    );
    try {
      await assert.rejects(
        () => discoverMetaAccounts("instagram", token),
        (error: unknown) => error instanceof ProviderError && error.retryable,
      );
      assert.equal(stub.mock.callCount(), 1);
    } finally {
      stub.mock.restore();
    }
  }
});

test("empty Pages explain missing access without treating a personal profile as a Page", async () => {
  const stub = mock.method(globalThis, "fetch", async (url: string) =>
    url.includes("/me?")
      ? Response.json({ id: "111", name: "Personal profile" })
      : Response.json({ data: [] }),
  );
  try {
    await assert.rejects(
      () => discoverMetaAccounts("facebook", token),
      /Tidak ada Facebook Page/,
    );
  } finally {
    stub.mock.restore();
  }
});

test("incomplete pagination fails rather than silently omitting account choices", async () => {
  const stub = mock.method(globalThis, "fetch", async (url: string) =>
    url.includes("/me?")
      ? new Response(null, { status: 400 })
      : Response.json({
          data: [{ id: "123", name: "Test Page", access_token: pageToken }],
          paging: { next: "https://example.invalid" },
        }),
  );
  try {
    await assert.rejects(
      () => discoverMetaAccounts("facebook", token),
      /diambil lengkap/,
    );
  } finally {
    stub.mock.restore();
  }
});
