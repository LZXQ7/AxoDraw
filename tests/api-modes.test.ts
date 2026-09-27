import assert from "node:assert/strict";
import test from "node:test";
import { POST as createRoute } from "../src/app/api/lotteries/route";
import { POST as drawRoute } from "../src/app/api/lotteries/[code]/draw/route";
import { GET as verifyRoute } from "../src/app/api/lotteries/[code]/verify/route";
import { DRAND_QUICKNET_CHAIN_HASH, DRAND_QUICKNET_PUBLIC_KEY } from "../src/lib/beacon";
import { createLottery, saveLottery } from "../src/lib/lottery-store";

// quicknet round 8550012 的真实 randomness 与签名，用于离线跑通开奖与验证。
const realBeacon = {
  round: 8_550_012,
  randomness:
    "f876d09fc9438e7d53dafb9bd1f2f3c78fe4e85ad9d272e1f979aa572247fb7a",
  signature:
    "88f87a10205ed031a3ae1eec64c4780c9aa787a679788b6259d0b973ea061d612c6bfb395eafacc788feeb5be11b2f18",
};

function stubNetwork() {
  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_HOSTNAMES = "localhost";
  process.env.TURNSTILE_SECRET = "test";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("turnstile")) {
      return Response.json({
        success: true,
        action: "create-lottery",
        hostname: "localhost",
      });
    }
    if (url.endsWith("/info")) {
      return Response.json({
        public_key: DRAND_QUICKNET_PUBLIC_KEY,
        period: 3,
        genesis_time: 1692803367,
        hash: DRAND_QUICKNET_CHAIN_HASH,
        groupHash:
          "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
        schemeID: "bls-unchained-g1-rfc9380",
        metadata: { beaconID: "quicknet" },
      });
    }
    if (url.includes(`/public/${realBeacon.round}`)) {
      return Response.json(realBeacon);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/lotteries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

const entriesText = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
const baseBody = {
  deadline: "2030-01-01T10:00",
  entriesText,
  "cf-turnstile-response": "token",
};

test("创建接口接受三种模式并按模式规范化参数", async () => {
  const restore = stubNetwork();
  try {
    const lottery = await createRoute(
      createRequest({ ...baseBody, title: "抽奖", mode: "lottery", winnerCount: 3 }),
    );
    const lotteryBody = await lottery.json();
    assert.equal(lottery.status, 201);
    assert.equal(lotteryBody.lottery.mode, "lottery");
    assert.equal(lotteryBody.lottery.winnerCount, 3);

    const shuffle = await createRoute(
      createRequest({ ...baseBody, title: "排序", mode: "shuffle" }),
    );
    const shuffleBody = await shuffle.json();
    assert.equal(shuffleBody.lottery.mode, "shuffle");
    assert.equal(shuffleBody.lottery.winnerCount, 7);
    assert.equal(shuffleBody.lottery.groupCount, undefined);

    const group = await createRoute(
      createRequest({ ...baseBody, title: "分组", mode: "group", groupCount: 3 }),
    );
    const groupBody = await group.json();
    assert.equal(groupBody.lottery.mode, "group");
    assert.equal(groupBody.lottery.groupCount, 3);
    assert.equal(groupBody.lottery.winnerCount, 7);
  } finally {
    restore();
  }
});

test("创建接口拒绝非法模式参数", async () => {
  const restore = stubNetwork();
  try {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...baseBody, title: "t", mode: "group", groupCount: 9 }, /分组数需在 2 与参与值数量之间/],
      [{ ...baseBody, title: "t", mode: "lottery", winnerCount: 99 }, /中奖人数需在 1 与参与值数量之间/],
      [{ ...baseBody, title: "t", mode: "sort" }, /抽奖方式无效/],
    ];
    for (const [body, pattern] of cases) {
      const response = await createRoute(createRequest(body));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, pattern);
    }
  } finally {
    restore();
  }
});

test("分组模式可以开奖并独立验证通过", async () => {
  const restore = stubNetwork();
  try {
    const created = createLottery({
      title: "分组演示",
      description: "",
      deadline: "2024-06-15T12:00:00.000Z",
      mode: "group",
      groupCount: 3,
      winnerCount: 7,
      duplicatePolicy: "keep",
      entries: ["a", "b", "c", "d", "e", "f", "g"],
    });
    created.lottery.commitmentUpdatedAt = "2024-06-15T11:59:59.000Z";
    await saveLottery(created.lottery);
    const context = { params: Promise.resolve({ code: created.lottery.code }) };

    const drawn = await drawRoute(
      new Request(`http://localhost/api/lotteries/${created.lottery.code}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: created.managementToken }),
      }),
      context,
    );
    const drawnBody = await drawn.json();
    assert.equal(drawn.status, 200);
    assert.equal(drawnBody.lottery.status, "drawn");
    assert.deepEqual(
      drawnBody.lottery.groups.map((group: string[]) => group.length),
      [3, 2, 2],
    );
    assert.deepEqual(
      drawnBody.lottery.groups.flat(),
      drawnBody.lottery.winners,
    );

    const verified = await verifyRoute(
      new Request("http://localhost"),
      context,
    );
    const verifiedBody = await verified.json();
    assert.equal(verifiedBody.verified, true);
    assert.equal(verifiedBody.checks.groupsMatch, true);

    // 篡改分组后验证必须失败
    created.lottery.groups![0][0] = "attacker";
    await saveLottery(created.lottery);
    const tampered = await verifyRoute(new Request("http://localhost"), context);
    assert.equal((await tampered.json()).verified, false);
  } finally {
    restore();
  }
});
