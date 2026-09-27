import { drawModes, isDrawMode, type DrawMode } from "@/lib/lottery";

export class InvalidLotteryParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLotteryParamsError";
  }
}

export type LotteryParams = {
  mode: DrawMode;
  /** lottery 模式为名额数；shuffle / group 模式排序全部参与值。 */
  winnerCount: number;
  groupCount?: number;
};

/**
 * 校验并规范化三种模式的结果参数。entryCount 必须是最终（去重后）参与值数量，
 * 因此创建与截止前修改名单共用同一套规则。
 */
export function parseLotteryParams(
  input: { mode?: unknown; winnerCount?: unknown; groupCount?: unknown },
  entryCount: number,
): LotteryParams {
  const mode = input.mode ?? "lottery";
  if (!isDrawMode(mode)) {
    throw new InvalidLotteryParamsError(
      `抽奖方式无效，只能是：${drawModes.join(" / ")}`,
    );
  }

  if (mode === "lottery") {
    const winnerCount = Number(input.winnerCount);
    if (
      !Number.isInteger(winnerCount) ||
      winnerCount < 1 ||
      winnerCount > entryCount
    ) {
      throw new InvalidLotteryParamsError("中奖人数需在 1 与参与值数量之间");
    }
    return { mode, winnerCount };
  }

  if (mode === "group") {
    const groupCount = Number(input.groupCount);
    if (
      !Number.isInteger(groupCount) ||
      groupCount < 2 ||
      groupCount > entryCount
    ) {
      throw new InvalidLotteryParamsError("分组数需在 2 与参与值数量之间");
    }
    return { mode, winnerCount: entryCount, groupCount };
  }

  return { mode, winnerCount: entryCount };
}
