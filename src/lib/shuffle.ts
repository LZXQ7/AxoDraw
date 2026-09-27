/**
 * 本地即时排序用的均匀随机源与无偏洗牌。
 * 与服务端 deterministic-v2 的洗牌规则保持一致（Fisher–Yates + 拒绝采样），
 * 区别只在于随机源：这里用浏览器的 crypto.getRandomValues，没有公开信标记录。
 */

/** [0, bound) 上的均匀随机整数：用拒绝采样丢掉取模偏差，而不是近似。 */
export function cryptoRandomInt(bound: number): number {
  if (!Number.isInteger(bound) || bound < 1) {
    throw new Error("bound 必须是正整数");
  }
  if (bound === 1) return 0;
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / bound) * bound;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < limit) return value % bound;
  }
}

/** 无偏 Fisher–Yates；randomInt(bound) 需返回 [0, bound) 的均匀整数。 */
export function shuffleWith<T>(
  items: readonly T[],
  randomInt: (bound: number) => number,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function shuffle<T>(items: readonly T[]): T[] {
  return shuffleWith(items, cryptoRandomInt);
}

/**
 * 把随机顺序连续切成 groupCount 组：均匀随机排列下等价于均匀随机分组，
 * 各组人数相差不超过 1（前面的组多 1 人）。
 */
export function splitIntoGroups<T>(
  items: readonly T[],
  groupCount: number,
): T[][] {
  const base = Math.floor(items.length / groupCount);
  const remainder = items.length % groupCount;
  const groups: T[][] = [];
  let cursor = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    groups.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}
