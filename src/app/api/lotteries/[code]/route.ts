import { NextResponse } from "next/server";
import {
  InvalidLotteryParamsError,
  parseLotteryParams,
} from "@/lib/lottery-params";
import {
  getLottery,
  publicLottery,
  refreshEntriesCommitment,
  saveLottery,
  verifyToken,
} from "@/lib/lottery-store";
import { formatBeijing } from "@/lib/time";

function readToken(request: Request, body: Record<string, unknown>) {
  return String(body.token || request.headers.get("x-management-token") || "");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const lottery = await getLottery(code);
  if (!lottery)
    return NextResponse.json({ error: "未找到这个抽奖" }, { status: 404 });
  return NextResponse.json({ lottery: publicLottery(lottery) });
}

/**
 * 通过管理链接在截止时间之前修改参与值。
 * - 仅限未开奖且未过截止时间的抽奖；
 * - 参与值需至少 2 条；沿用创建时的去重策略；去重后数量需不少于中奖名额；
 * - 修改会影响最终 digest 的输入，但开奖信标在截止后才生成，无法据此作弊。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const lottery = await getLottery(code);
  if (!lottery)
    return NextResponse.json({ error: "未找到这个抽奖" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!verifyToken(lottery, readToken(request, body)))
    return NextResponse.json({ error: "管理凭证无效" }, { status: 401 });
  if (lottery.status === "drawn")
    return NextResponse.json(
      { error: "已开奖，无法再修改参与值" },
      { status: 409 },
    );
  const deadlineAt = new Date(lottery.deadline).getTime();
  const updatedAt = Date.now();
  if (updatedAt >= deadlineAt)
    return NextResponse.json(
      {
        error: `已过截止时间（${formatBeijing(deadlineAt)} 北京时间），无法再修改参与值`,
      },
      { status: 409 },
    );

  const items = String(body.entriesText ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length < 2)
    return NextResponse.json(
      { error: "至少需要 2 条参与值" },
      { status: 400 },
    );
  const normalized =
    lottery.duplicatePolicy === "dedupe" ? [...new Set(items)] : items;
  // 模式、名额与分组数创建后固定，这里只重新校验它们在最新名单下依然成立。
  let params;
  try {
    params = parseLotteryParams(
      {
        mode: lottery.mode,
        winnerCount: lottery.winnerCount,
        groupCount: lottery.groupCount,
      },
      normalized.length,
    );
  } catch (cause) {
    const message =
      cause instanceof InvalidLotteryParamsError
        ? cause.message
        : "请求格式无效";
    return NextResponse.json(
      { error: normalized.length < items.length ? `去重后${message}` : message },
      { status: 400 },
    );
  }

  lottery.entries = normalized;
  lottery.winnerCount = params.winnerCount;
  lottery.groupCount = params.groupCount;
  refreshEntriesCommitment(lottery, new Date(updatedAt).toISOString());
  await saveLottery(lottery);
  return NextResponse.json({ lottery: publicLottery(lottery) });
}
