import { createHash, createHmac, randomBytes } from "node:crypto";
import type { QuicknetBeacon } from "@/lib/beacon";
import { drawModeOf, sampleCodes, type DrawMode } from "@/lib/lottery";
import { splitIntoGroups } from "@/lib/shuffle";
import { loadLottery, persistLottery } from "@/lib/supabase";

export const CURRENT_DRAW_ALGORITHM = "deterministic-v2" as const;
export type DrawAlgorithm = "deterministic-v1" | typeof CURRENT_DRAW_ALGORITHM;
export type LotteryStatus = "scheduled" | "drawn";

export type Lottery = {
  code: string;
  title: string;
  description: string;
  deadline: string;
  /** 缺省视为 lottery：没有 mode 字段的旧记录保持原有语义。 */
  mode?: DrawMode;
  winnerCount: number;
  groupCount?: number;
  duplicatePolicy: "keep" | "dedupe";
  entries: string[];
  status: LotteryStatus;
  /** lottery 模式为中奖名单；shuffle / group 模式为完整随机顺序。 */
  winners: string[];
  /** 仅 group 模式：按随机顺序连续切分出的分组。 */
  groups?: string[][];
  managementTokenHash: string;
  /**
   * Public snapshot hash of every field that affects the draw. This lets
   * participants save the value before the deadline and detect later changes.
   * It is not, by itself, an external timestamp or transparency log.
   */
  entriesCommitment?: string;
  commitmentUpdatedAt?: string;
  draw?: {
    round: number;
    randomness: string;
    signature: string;
    algorithm: DrawAlgorithm;
    drawnAt: string;
    digest: string;
    entriesCommitment?: string;
  };
};

export type DrawOutcome = {
  digest: string;
  winners: string[];
  groups?: string[][];
};

type PublicLottery = Omit<Lottery, "managementTokenHash"> & {
  managementToken?: string;
};

type NewLotteryInput = Pick<
  Lottery,
  | "title"
  | "description"
  | "deadline"
  | "winnerCount"
  | "duplicatePolicy"
  | "entries"
> & {
  mode?: DrawMode;
  groupCount?: number;
};

const store = globalThis as typeof globalThis & {
  __axodraw?: Map<string, Lottery>;
};
const lotteries = store.__axodraw ?? new Map<string, Lottery>();
store.__axodraw = lotteries;

const COMMITMENT_VERSION = "axodraw-commitment-v1";
/** 随机排序 / 分组模式额外把 mode 与 groupCount 纳入承诺，使用新版本号。 */
const MODE_COMMITMENT_VERSION = "axodraw-commitment-v2";
const V2_BLOCK_DOMAIN = Buffer.from("axodraw-deterministic-v2\0", "utf8");
const UINT256_SPACE = 1n << 256n;

export function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Canonical, versioned snapshot of every stored field that affects a draw.
 * lottery 模式沿用 commitment-v1 的字段与顺序，保证历史记录仍然可复算。
 */
export function computeEntriesCommitment(
  lottery: Pick<
    Lottery,
    | "code"
    | "title"
    | "description"
    | "deadline"
    | "winnerCount"
    | "duplicatePolicy"
    | "entries"
  > & { mode?: DrawMode; groupCount?: number },
) {
  const mode = drawModeOf(lottery);
  const canonical =
    mode === "lottery"
      ? JSON.stringify({
          version: COMMITMENT_VERSION,
          code: lottery.code,
          title: lottery.title,
          description: lottery.description,
          deadline: lottery.deadline,
          winnerCount: lottery.winnerCount,
          duplicatePolicy: lottery.duplicatePolicy,
          entries: lottery.entries,
        })
      : JSON.stringify({
          version: MODE_COMMITMENT_VERSION,
          code: lottery.code,
          title: lottery.title,
          description: lottery.description,
          deadline: lottery.deadline,
          mode,
          groupCount: mode === "group" ? lottery.groupCount ?? null : null,
          winnerCount: lottery.winnerCount,
          duplicatePolicy: lottery.duplicatePolicy,
          entries: lottery.entries,
        });
  return `sha256:${hash(canonical)}`;
}

export function refreshEntriesCommitment(
  lottery: Lottery,
  updatedAt = new Date().toISOString(),
) {
  lottery.entriesCommitment = computeEntriesCommitment(lottery);
  lottery.commitmentUpdatedAt = updatedAt;
  return lottery.entriesCommitment;
}

/** 把一次无偏洗牌结果按模式解释为中奖名单 / 完整顺序 / 分组。 */
function outcome(
  lottery: Lottery,
  digest: string,
  order: string[],
): DrawOutcome {
  const mode = drawModeOf(lottery);
  if (mode === "group") {
    const groupCount = lottery.groupCount ?? 0;
    return groupCount >= 2
      ? { digest, winners: order, groups: splitIntoGroups(order, groupCount) }
      : { digest, winners: order };
  }
  if (mode === "shuffle") return { digest, winners: order };
  return { digest, winners: order.slice(0, lottery.winnerCount) };
}

function legacyV1Result(lottery: Lottery, randomness: string) {
  const digest = hash(
    [
      randomness,
      lottery.code,
      lottery.entries.join("\n"),
      "deterministic-v1",
    ].join("|"),
  );
  const available = [...lottery.entries];
  let state = BigInt(`0x${digest}`);
  for (let i = available.length - 1; i > 0; i -= 1) {
    state =
      (state * 6364136223846793005n + 1442695040888963407n) &
      (UINT256_SPACE - 1n);
    const j = Number(state % BigInt(i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return outcome(lottery, `sha256:${digest}`, available);
}

/**
 * Generates a domain-separated HMAC block for one rejection-sampling attempt.
 * A fresh counter is used for every block, avoiding the low-bit correlations
 * that made deterministic-v1's LCG shuffle strongly order-biased.
 */
function v2Block(seed: Buffer, counter: bigint) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  return createHmac("sha256", seed)
    .update(V2_BLOCK_DOMAIN)
    .update(counterBytes)
    .digest();
}

function deterministicV2Result(lottery: Lottery, randomness: string) {
  const commitment = computeEntriesCommitment(lottery);
  const digest = hash(
    [randomness, commitment, CURRENT_DRAW_ALGORITHM].join("|"),
  );
  const seed = Buffer.from(digest, "hex");
  const available = [...lottery.entries];
  let counter = 0n;

  for (let i = available.length - 1; i > 0; i -= 1) {
    const bound = BigInt(i + 1);
    // Reject the short tail so every index has exactly the same number of
    // 256-bit preimages. This removes modulo bias instead of approximating it.
    const limit = UINT256_SPACE - (UINT256_SPACE % bound);
    let sample: bigint;
    do {
      sample = BigInt(`0x${v2Block(seed, counter).toString("hex")}`);
      counter += 1n;
    } while (sample >= limit);
    const j = Number(sample % bound);
    [available[i], available[j]] = [available[j], available[i]];
  }

  return outcome(lottery, `sha256:${digest}`, available);
}

export function computeDrawResult(
  lottery: Lottery,
  randomness: string,
  algorithm: DrawAlgorithm,
): DrawOutcome {
  return algorithm === "deterministic-v1"
    ? legacyV1Result(lottery, randomness)
    : deterministicV2Result(lottery, randomness);
}

// 三个示例记录共用同一个真实信标：quicknet round 8550012。
// 签名、randomness、摘要与结果全部由生产路径的算法算出来。
const SAMPLE_DEADLINE = "2024-06-15T12:00:00.000Z";
const SAMPLE_COMMITMENT_TIME = "2024-06-15T11:59:59.000Z";
const SAMPLE_ROUND = 8_550_012;
const SAMPLE_RANDOMNESS =
  "f876d09fc9438e7d53dafb9bd1f2f3c78fe4e85ad9d272e1f979aa572247fb7a";
const SAMPLE_SIGNATURE =
  "88f87a10205ed031a3ae1eec64c4780c9aa787a679788b6259d0b973ea061d612c6bfb395eafacc788feeb5be11b2f18";

type SampleSpec = {
  mode: DrawMode;
  code: string;
  title: string;
  description: string;
  winnerCount: number;
  groupCount?: number;
  entries: string[];
};

const sampleSpecs: SampleSpec[] = [
  {
    mode: "lottery",
    code: sampleCodes.lottery,
    title: "示例抽奖（演示数据）",
    description:
      "这是一条用于演示的示例数据，不代表任何真实活动；结果由 drand 公开信标真实生成，可独立核验抽奖方法与结果。",
    winnerCount: 3,
    entries: [
      "service-001",
      "service-002",
      "service-003",
      "service-004",
      "service-005",
    ],
  },
  {
    mode: "shuffle",
    code: sampleCodes.shuffle,
    title: "示例：随机排序（演示数据）",
    description:
      "演示「随机排序」：8 个参与值被同一套无偏算法完全打乱，下面的顺序就是完整结果，可逐项复算。",
    winnerCount: 8,
    entries: [
      "service-011",
      "service-012",
      "service-013",
      "service-014",
      "service-015",
      "service-016",
      "service-017",
      "service-018",
    ],
  },
  {
    mode: "group",
    code: sampleCodes.group,
    title: "示例：分组随机排序（演示数据）",
    description:
      "演示「分组随机排序」：先随机排序，再按顺序均分成 3 组；8 个参与值分到 3 组，人数相差不超过 1。",
    winnerCount: 8,
    groupCount: 3,
    entries: [
      "service-021",
      "service-022",
      "service-023",
      "service-024",
      "service-025",
      "service-026",
      "service-027",
      "service-028",
    ],
  },
];

function buildSampleLottery(spec: SampleSpec): Lottery {
  const lottery: Lottery = {
    code: spec.code,
    title: spec.title,
    description: spec.description,
    deadline: SAMPLE_DEADLINE,
    mode: spec.mode,
    winnerCount: spec.winnerCount,
    duplicatePolicy: "keep",
    entries: spec.entries,
    status: "scheduled",
    winners: [],
    managementTokenHash: "sample",
  };
  if (spec.groupCount) lottery.groupCount = spec.groupCount;
  lottery.entriesCommitment = computeEntriesCommitment(lottery);
  lottery.commitmentUpdatedAt = SAMPLE_COMMITMENT_TIME;

  const result = deterministicV2Result(lottery, SAMPLE_RANDOMNESS);
  lottery.status = "drawn";
  lottery.winners = result.winners;
  if (result.groups) lottery.groups = result.groups;
  lottery.draw = {
    round: SAMPLE_ROUND,
    randomness: SAMPLE_RANDOMNESS,
    signature: SAMPLE_SIGNATURE,
    algorithm: CURRENT_DRAW_ALGORITHM,
    drawnAt: "2024-06-15T12:10:05.000Z",
    digest: result.digest,
    entriesCommitment: lottery.entriesCommitment,
  };
  return lottery;
}

function seedSampleLotteries() {
  for (const spec of sampleSpecs) {
    const sample = buildSampleLottery(spec);
    const existing = lotteries.get(spec.code);
    const legacy =
      existing &&
      (existing.draw?.algorithm !== CURRENT_DRAW_ALGORITHM ||
        existing.draw?.digest !== sample.draw?.digest);
    if (!existing || legacy) lotteries.set(spec.code, sample);
  }
}
seedSampleLotteries();

export function publicLottery(lottery: Lottery): PublicLottery {
  const { managementTokenHash, ...safe } = lottery;
  void managementTokenHash;
  return safe;
}

export function createLottery(input: NewLotteryInput) {
  // 64 random bits keep accidental collisions negligible even at large scale.
  const code = `AXO-${randomBytes(8).toString("hex").toUpperCase()}`;
  const managementToken = randomBytes(24).toString("base64url");
  const mode = drawModeOf(input);
  const lottery: Lottery = {
    ...input,
    mode,
    code,
    status: "scheduled",
    winners: [],
    managementTokenHash: hash(managementToken),
  };
  if (mode === "group") lottery.groupCount = input.groupCount;
  else delete lottery.groupCount;
  refreshEntriesCommitment(lottery);
  return { lottery, managementToken };
}

export function findLottery(code: string) {
  return lotteries.get(code.toUpperCase());
}

export async function getLottery(code: string) {
  const normalized = code.toUpperCase();
  // Prefer durable storage so separate server instances cannot draw from a
  // stale in-memory copy after another instance updates the participant list.
  const stored = await loadLottery(normalized);
  if (stored) {
    lotteries.set(normalized, stored);
    return stored;
  }
  return lotteries.get(normalized) ?? null;
}

export async function saveLottery(lottery: Lottery) {
  await persistLottery(lottery);
  lotteries.set(lottery.code, lottery);
}

export function verifyToken(lottery: Lottery, token: string) {
  return Boolean(token) && hash(token) === lottery.managementTokenHash;
}

export function drawLottery(lottery: Lottery, beacon: QuicknetBeacon) {
  if (lottery.status === "drawn") return lottery;
  const commitment = computeEntriesCommitment(lottery);
  if (!lottery.entriesCommitment || lottery.entriesCommitment !== commitment) {
    throw new Error("参与值承诺缺失或与当前记录不一致");
  }
  const result = computeDrawResult(
    lottery,
    beacon.randomness,
    CURRENT_DRAW_ALGORITHM,
  );
  lottery.winners = result.winners;
  if (result.groups) lottery.groups = result.groups;
  else delete lottery.groups;
  lottery.status = "drawn";
  lottery.draw = {
    round: beacon.round,
    randomness: beacon.randomness,
    signature: beacon.signature,
    algorithm: CURRENT_DRAW_ALGORITHM,
    drawnAt: new Date().toISOString(),
    digest: result.digest,
    entriesCommitment: commitment,
  };
  return lottery;
}
