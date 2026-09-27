import { formatBeijing } from "@/lib/time";

/**
 * 三种结果模式共用同一套信标与确定性算法：
 * - lottery：随机抽奖，取洗牌结果的前 winnerCount 项；
 * - shuffle：随机排序，输出完整随机顺序；
 * - group：分组随机排序，先随机排序，再按顺序均分成 groupCount 组。
 * mode 缺省视为 lottery，旧记录（无 mode 字段）因此仍可复算与验证。
 */
export type DrawMode = "lottery" | "shuffle" | "group";

export type Lottery = {
  code: string;
  title: string;
  description: string;
  deadline: string;
  mode?: DrawMode;
  winnerCount: number;
  groupCount?: number;
  duplicatePolicy: "keep" | "dedupe";
  entries: string[];
  status: "scheduled" | "drawn";
  /** lottery 模式为中奖名单；shuffle / group 模式为完整随机顺序。 */
  winners: string[];
  /** 仅 group 模式：按随机顺序连续切分出的分组。 */
  groups?: string[][];
  entriesCommitment?: string;
  commitmentUpdatedAt?: string;
  managementToken?: string;
  draw?: {
    round: number;
    randomness: string;
    signature: string;
    algorithm: "deterministic-v1" | "deterministic-v2";
    drawnAt: string;
    digest: string;
    entriesCommitment?: string;
  };
};

export type DrawVerification = {
  verified: boolean;
  fair: boolean;
  reason: string;
  checks?: Record<string, boolean>;
  expectedRound?: number;
  expectedCommitment?: string;
};

export const drawModes: DrawMode[] = ["lottery", "shuffle", "group"];

export const isDrawMode = (value: unknown): value is DrawMode =>
  typeof value === "string" && (drawModes as string[]).includes(value);

export const drawModeOf = (lottery: { mode?: DrawMode }): DrawMode =>
  lottery.mode ?? "lottery";

export const drawModeMeta: Record<
  DrawMode,
  {
    label: string;
    tagline: string;
    resultTitle: string;
    unit: string;
    action: string;
    drawnBadge: string;
    pendingTitle: string;
    pendingHint: string;
    countStatLabel: string;
  }
> = {
  lottery: {
    label: "随机抽奖",
    tagline: "从全部参与值中随机抽取指定数量的中奖者。",
    resultTitle: "中奖结果",
    unit: "WINNERS",
    action: "立即开奖",
    drawnBadge: "已开奖",
    pendingTitle: "开奖尚未开始",
    pendingHint: "截止后 10 分钟，可用管理链接开奖。",
    countStatLabel: "中奖名额",
  },
  shuffle: {
    label: "随机排序",
    tagline: "把全部参与值随机打乱，得到一个完整、不重不漏的随机顺序。",
    resultTitle: "随机排序结果",
    unit: "ITEMS",
    action: "生成排序结果",
    drawnBadge: "已排序",
    pendingTitle: "排序结果尚未生成",
    pendingHint: "截止后 10 分钟，可用管理链接生成排序结果。",
    countStatLabel: "排序条目",
  },
  group: {
    label: "分组随机排序",
    tagline: "先随机打乱全部参与值，再按顺序均分成若干组，组内顺序同样随机。",
    resultTitle: "分组结果",
    unit: "GROUPS",
    action: "生成分组结果",
    drawnBadge: "已分组",
    pendingTitle: "分组结果尚未生成",
    pendingHint: "截止后 10 分钟，可用管理链接生成分组结果。",
    countStatLabel: "分组数",
  },
};

/** 三种模式各有一个内存示例记录，信标都是真实的 quicknet 轮次。 */
export const sampleCodes: Record<DrawMode, string> = {
  lottery: "AXO-7K4M",
  shuffle: "AXO-7K4S",
  group: "AXO-7K4G",
};

export const entries = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

// 全站统一以北京时间为准展示时间，与查看者浏览器时区无关
export const dateLabel = (value: string) => `${formatBeijing(value)}（北京时间）`;
