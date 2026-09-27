import type { QuicknetBeacon } from "@/lib/beacon";
import { isDrawMode } from "@/lib/lottery";
import {
  computeDrawResult,
  computeEntriesCommitment,
  CURRENT_DRAW_ALGORITHM,
  type DrawAlgorithm,
  type Lottery,
} from "@/lib/lottery-store";

const supportedAlgorithms = new Set<DrawAlgorithm>([
  "deterministic-v1",
  CURRENT_DRAW_ALGORITHM,
]);

type DrawVerificationChecks = {
  expectedRound: boolean;
  beaconSignature: boolean;
  commitmentBeforeDeadline: boolean;
  commitmentMatches: boolean;
  modeSupported: boolean;
  algorithmSupported: boolean;
  fairAlgorithm: boolean;
  digestMatches: boolean;
  winnersMatch: boolean;
  groupsMatch: boolean;
};

export type DrawRecordVerification = {
  verified: boolean;
  fair: boolean;
  checks: DrawVerificationChecks;
  expectedCommitment: string;
  reason: string;
};

const failedChecks: DrawVerificationChecks = {
  expectedRound: false,
  beaconSignature: false,
  commitmentBeforeDeadline: false,
  commitmentMatches: false,
  modeSupported: false,
  algorithmSupported: false,
  fairAlgorithm: false,
  digestMatches: false,
  winnersMatch: false,
  groupsMatch: false,
};

function sameList(left: string[] | undefined, right: string[] | undefined) {
  if (!left || !right) return false;
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function sameGroups(
  left: string[][] | undefined,
  right: string[][] | undefined,
) {
  if (!left || !right) return false;
  return (
    left.length === right.length &&
    left.every((group, index) => sameList(group, right[index]))
  );
}

export function verifyDrawRecord(
  lottery: Lottery,
  beacon: QuicknetBeacon,
  expectedRound: number,
): DrawRecordVerification {
  const draw = lottery.draw;
  if (!draw) {
    return {
      verified: false,
      fair: false,
      checks: { ...failedChecks },
      expectedCommitment: computeEntriesCommitment(lottery),
      reason: "抽奖尚未开奖",
    };
  }

  const algorithm = draw.algorithm;
  const algorithmSupported = supportedAlgorithms.has(algorithm);
  const fairAlgorithm = algorithm === CURRENT_DRAW_ALGORITHM;
  // 没有 mode 字段的历史记录视为 lottery；出现未知 mode 说明记录被改写。
  const modeSupported = lottery.mode === undefined || isDrawMode(lottery.mode);
  const expectedCommitment = computeEntriesCommitment(lottery);
  const commitmentUpdatedAt = new Date(
    lottery.commitmentUpdatedAt ?? "",
  ).getTime();
  const commitmentBeforeDeadline =
    Number.isFinite(commitmentUpdatedAt) &&
    commitmentUpdatedAt < new Date(lottery.deadline).getTime();
  const commitmentMatches =
    lottery.entriesCommitment === expectedCommitment &&
    draw.entriesCommitment === expectedCommitment;

  let digestMatches = false;
  let winnersMatch = false;
  let groupsMatch = false;
  if (algorithmSupported && modeSupported) {
    const expectedResult = computeDrawResult(
      lottery,
      beacon.randomness,
      algorithm,
    );
    digestMatches = draw.digest === expectedResult.digest;
    winnersMatch = sameList(lottery.winners, expectedResult.winners);
    // 只有分组模式才有分组结果；其余模式（含旧记录）不因此失败。
    groupsMatch =
      lottery.mode === "group"
        ? sameGroups(lottery.groups, expectedResult.groups)
        : true;
  }

  const checks = {
    expectedRound: draw.round === expectedRound,
    beaconSignature:
      draw.signature === beacon.signature &&
      draw.randomness === beacon.randomness,
    commitmentBeforeDeadline,
    commitmentMatches,
    modeSupported,
    algorithmSupported,
    fairAlgorithm,
    digestMatches,
    winnersMatch,
    groupsMatch,
  };
  const verified = Object.values(checks).every(Boolean);

  return {
    verified,
    fair: verified,
    checks,
    expectedCommitment,
    reason: verified
      ? "轮次、信标签名、参与值承诺、结果模式、无偏算法、摘要与结果名单均验证通过"
      : fairAlgorithm
        ? "至少一项验证未通过"
        : "旧版 deterministic-v1 存在顺序偏差，不能视为公平结果",
  };
}
