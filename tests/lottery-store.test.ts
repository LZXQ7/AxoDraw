import assert from "node:assert/strict";
import test from "node:test";
import { parseDrawRequestBody } from "../src/lib/draw-request";
import { drawModeOf, drawModes, sampleCodes } from "../src/lib/lottery";
import { splitIntoGroups } from "../src/lib/shuffle";
import {
  InvalidLotteryParamsError,
  parseLotteryParams,
} from "../src/lib/lottery-params";
import {
  computeDrawResult,
  computeEntriesCommitment,
  createLottery,
  drawLottery,
  findLottery,
  hash,
  type Lottery,
} from "../src/lib/lottery-store";
import { verifyDrawRecord } from "../src/lib/verify-draw";

function fixture(overrides: Partial<Lottery> = {}): Lottery {
  const lottery: Lottery = {
    code: "AXO-TEST",
    title: "test",
    description: "",
    deadline: "2030-01-01T00:00:00.000Z",
    winnerCount: 2,
    duplicatePolicy: "keep",
    entries: ["a", "b", "c", "d", "e"],
    status: "scheduled",
    winners: [],
    managementTokenHash: "test",
    commitmentUpdatedAt: "2029-12-31T23:59:00.000Z",
    ...overrides,
  };
  lottery.entriesCommitment = computeEntriesCommitment(lottery);
  return lottery;
}

test("deterministic-v2 has a stable cross-implementation vector", () => {
  const lottery = fixture();
  assert.equal(
    lottery.entriesCommitment,
    "sha256:26030f8047aea28e25b430dff8340978591b436cf863f30d5a72648dedc8bdd6",
  );
  assert.deepEqual(
    computeDrawResult(lottery, "00".repeat(32), "deterministic-v2"),
    {
      digest:
        "sha256:1052b095ac3c895cc96668c3f3c3ddc6c0ca91ad43330981be761098c6953b84",
      winners: ["b", "c"],
    },
  );
});

test("new lotteries use a 64-bit public code and publish a commitment", () => {
  const { lottery, managementToken } = createLottery({
    title: "new",
    description: "",
    deadline: "2030-01-01T00:00:00.000Z",
    winnerCount: 1,
    duplicatePolicy: "keep",
    entries: ["a", "b"],
  });
  assert.match(lottery.code, /^AXO-[0-9A-F]{16}$/);
  assert.match(managementToken, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(lottery.entriesCommitment, computeEntriesCommitment(lottery));
});

test("deterministic-v2 removes the v1 low-bit permutation restriction", () => {
  const lottery = fixture({
    code: "AXO-FAIR",
    title: "fair",
    winnerCount: 4,
    entries: ["a", "b", "c", "d"],
  });
  const permutations = new Set<string>();
  const firstCounts = new Map(lottery.entries.map((entry) => [entry, 0]));

  for (let index = 0; index < 10_000; index += 1) {
    const result = computeDrawResult(
      lottery,
      hash(String(index)),
      "deterministic-v2",
    );
    permutations.add(result.winners.join(""));
    firstCounts.set(
      result.winners[0],
      (firstCounts.get(result.winners[0]) ?? 0) + 1,
    );
  }

  assert.equal(permutations.size, 24);
  for (const count of firstCounts.values()) {
    assert.ok(count > 2_300 && count < 2_700, `unexpected count ${count}`);
  }
});

test("legacy deterministic-v1 records remain reproducible but are not reused", () => {
  const lottery = fixture({
    code: "AXO-7K4M",
    winnerCount: 3,
    entries: [
      "service-001",
      "service-002",
      "service-003",
      "service-004",
      "service-005",
    ],
  });
  assert.deepEqual(
    computeDrawResult(
      lottery,
      "f876d09fc9438e7d53dafb9bd1f2f3c78fe4e85ad9d272e1f979aa572247fb7a",
      "deterministic-v1",
    ),
    {
      digest:
        "sha256:f9e3cba8be88cbe68e6d0c67fcc93a7b308a5ecb939cebec8017e544ddb3ad96",
      winners: ["service-003", "service-004", "service-002"],
    },
  );
});

test("draw refuses a changed list and records a verified v2 beacon", () => {
  const lottery = fixture();
  lottery.entries[0] = "tampered";
  assert.throws(
    () =>
      drawLottery(lottery, {
        round: 1,
        randomness: "00".repeat(32),
        signature: "11".repeat(48),
        verified: true,
      }),
    /承诺缺失或与当前记录不一致/,
  );

  lottery.entries[0] = "a";
  drawLottery(lottery, {
    round: 1,
    randomness: "00".repeat(32),
    signature: "11".repeat(48),
    verified: true,
  });
  assert.equal(lottery.draw?.algorithm, "deterministic-v2");
  assert.equal(lottery.draw?.entriesCommitment, lottery.entriesCommitment);
});

test("verification detects round, result, and commitment tampering", () => {
  const beacon = {
    round: 1,
    randomness: "00".repeat(32),
    signature: "11".repeat(48),
    verified: true as const,
  };
  const lottery = fixture();
  drawLottery(lottery, beacon);
  assert.equal(verifyDrawRecord(lottery, beacon, 1).verified, true);

  lottery.draw!.round = 2;
  assert.equal(verifyDrawRecord(lottery, beacon, 1).checks.expectedRound, false);
  lottery.draw!.round = 1;

  lottery.winners[0] = "attacker";
  assert.equal(verifyDrawRecord(lottery, beacon, 1).checks.winnersMatch, false);
  lottery.winners = computeDrawResult(
    lottery,
    beacon.randomness,
    "deterministic-v2",
  ).winners;

  lottery.entries[0] = "tampered";
  assert.equal(
    verifyDrawRecord(lottery, beacon, 1).checks.commitmentMatches,
    false,
  );
});

test("draw request accepts authentication only", () => {
  assert.deepEqual(parseDrawRequestBody({ token: "secret" }), {
    token: "secret",
  });
  for (const field of ["round", "randomness", "signature"]) {
    assert.throws(
      () => parseDrawRequestBody({ token: "secret", [field]: "attacker" }),
      new RegExp(field),
    );
  }
  assert.throws(() => parseDrawRequestBody(null), /请求格式无效/);
});

const beacon = (randomness: string) => ({
  round: 1,
  randomness,
  signature: "11".repeat(48),
  verified: true as const,
});

test("结果参数校验覆盖三种模式并兼容旧调用", () => {
  assert.deepEqual(parseLotteryParams({ winnerCount: 2 }, 5), {
    mode: "lottery",
    winnerCount: 2,
  });
  assert.deepEqual(parseLotteryParams({ mode: "shuffle" }, 5), {
    mode: "shuffle",
    winnerCount: 5,
  });
  assert.deepEqual(
    parseLotteryParams({ mode: "group", groupCount: 3 }, 8),
    { mode: "group", winnerCount: 8, groupCount: 3 },
  );
  assert.throws(
    () => parseLotteryParams({ mode: "lottery", winnerCount: 6 }, 5),
    /中奖人数需在 1 与参与值数量之间/,
  );
  assert.throws(
    () => parseLotteryParams({ mode: "group", groupCount: 1 }, 8),
    /分组数需在 2 与参与值数量之间/,
  );
  assert.throws(
    () => parseLotteryParams({ mode: "group", groupCount: 9 }, 8),
    /分组数需在 2 与参与值数量之间/,
  );
  assert.throws(
    () => parseLotteryParams({ mode: "sort" }, 5),
    InvalidLotteryParamsError,
  );
});

test("创建时按模式规范化参数", () => {
  const base = {
    title: "t",
    description: "",
    deadline: "2030-01-01T00:00:00.000Z",
    duplicatePolicy: "keep" as const,
  };
  const shuffle = createLottery({
    ...base,
    mode: "shuffle",
    winnerCount: 3,
    groupCount: 4,
    entries: ["a", "b", "c"],
  }).lottery;
  assert.equal(shuffle.mode, "shuffle");
  assert.equal(shuffle.groupCount, undefined);

  const group = createLottery({
    ...base,
    mode: "group",
    winnerCount: 4,
    groupCount: 2,
    entries: ["a", "b", "c", "d"],
  }).lottery;
  assert.equal(drawModeOf(group), "group");
  assert.equal(group.groupCount, 2);
});

test("shuffle 模式输出不重不漏的完整随机顺序", () => {
  const lottery = fixture({
    mode: "shuffle",
    winnerCount: 5,
    entries: ["a", "b", "c", "d", "e"],
  });
  const result = computeDrawResult(lottery, hash("shuffle"), "deterministic-v2");
  assert.equal(result.groups, undefined);
  assert.equal(result.winners.length, 5);
  assert.deepEqual([...result.winners].sort(), ["a", "b", "c", "d", "e"]);
});

test("group 模式把完整随机顺序均分成各组且可复算", () => {
  const lottery = fixture({
    mode: "group",
    groupCount: 3,
    winnerCount: 8,
    entries: ["a", "b", "c", "d", "e", "f", "g", "h"],
  });
  const result = computeDrawResult(lottery, hash("group"), "deterministic-v2");
  assert.deepEqual(result.groups?.map((group) => group.length), [3, 3, 2]);
  assert.deepEqual(
    result.groups?.flat().sort(),
    [...lottery.entries].sort(),
  );
  assert.deepEqual(result.winners, result.groups?.flat());
  assert.deepEqual(
    computeDrawResult(lottery, hash("group"), "deterministic-v2").groups,
    result.groups,
  );
});

test("splitIntoGroups 各组人数相差不超过 1 且覆盖全部参与值", () => {
  const items = Array.from({ length: 7 }, (_, index) => `item-${index}`);
  assert.deepEqual(splitIntoGroups(items, 3).map((group) => group.length), [
    3, 2, 2,
  ]);
  assert.deepEqual(
    splitIntoGroups(items, 7),
    items.map((item) => [item]),
  );
});

test("分组结果使用 commitment-v2，分组或模式被改写即验证失败", () => {
  const lottery = fixture({
    mode: "group",
    groupCount: 2,
    winnerCount: 4,
    entries: ["a", "b", "c", "d"],
  });
  const record = beacon("00".repeat(32));
  drawLottery(lottery, record);
  assert.equal(
    lottery.draw?.entriesCommitment,
    computeEntriesCommitment(lottery),
  );
  assert.equal(verifyDrawRecord(lottery, record, 1).verified, true);

  lottery.groups![0][0] = "attacker";
  assert.equal(verifyDrawRecord(lottery, record, 1).checks.groupsMatch, false);

  lottery.groups = computeDrawResult(lottery, record.randomness, "deterministic-v2").groups;
  assert.equal(verifyDrawRecord(lottery, record, 1).verified, true);

  lottery.mode = "shuffle";
  const tampered = verifyDrawRecord(lottery, record, 1);
  assert.equal(tampered.checks.commitmentMatches, false);
  assert.equal(tampered.verified, false);

  lottery.mode = "unknown" as Lottery["mode"];
  assert.equal(verifyDrawRecord(lottery, record, 1).checks.modeSupported, false);
});

test("没有 mode 字段的旧记录仍按抽奖语义验证", () => {
  const lottery = fixture();
  assert.equal(lottery.mode, undefined);
  const record = beacon("02".repeat(32));
  drawLottery(lottery, record);
  assert.equal(lottery.groups, undefined);
  assert.equal(computeEntriesCommitment(lottery), lottery.entriesCommitment);
  assert.equal(verifyDrawRecord(lottery, record, 1).verified, true);
});

test("三种模式的示例记录自洽", () => {
  for (const mode of drawModes) {
    const sample = findLottery(sampleCodes[mode]);
    assert.ok(sample, `missing sample for ${mode}`);
    assert.equal(sample.status, "drawn");
    assert.equal(drawModeOf(sample), mode);
    const expected =
      mode === "lottery" ? sample.winnerCount : sample.entries.length;
    assert.equal(sample.winners.length, expected);
    if (mode === "group") {
      assert.equal(sample.groups?.length, sample.groupCount);
      assert.deepEqual(
        sample.groups?.flat().sort(),
        [...sample.entries].sort(),
      );
    } else {
      assert.equal(sample.groups, undefined);
    }
  }
});
