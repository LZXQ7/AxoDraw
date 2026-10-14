import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { GroupCards, ResultList } from "../src/components/result-view";
import { cryptoRandomInt, pickWinners, shuffle, shuffleWith } from "../src/lib/shuffle";

test("shuffleWith 按 Fisher–Yates 逐位使用随机下标", () => {
  const bounds: number[] = [];
  const result = shuffleWith(["a", "b", "c", "d"], (bound) => {
    bounds.push(bound);
    return 0;
  });
  assert.deepEqual(bounds, [4, 3, 2]);
  assert.deepEqual(result, ["b", "c", "d", "a"]);
});

test("shuffle 不修改输入且保持全部元素", () => {
  const items = Array.from({ length: 200 }, (_, index) => `item-${index}`);
  const result = shuffle(items);
  assert.notEqual(result, items);
  assert.deepEqual([...result].sort(), [...items].sort());
});

test("cryptoRandomInt 返回值落在 [0, bound) 且覆盖全部取值", () => {
  for (const bound of [1, 2, 3, 7, 100]) {
    const seen = new Set<number>();
    for (let index = 0; index < 2_000; index += 1) {
      const value = cryptoRandomInt(bound);
      assert.ok(Number.isInteger(value) && value >= 0 && value < bound);
      seen.add(value);
    }
    assert.equal(seen.size, bound);
  }
  assert.throws(() => cryptoRandomInt(0), /bound 必须是正整数/);
  assert.throws(() => cryptoRandomInt(2.5), /bound 必须是正整数/);
});

test("结果视图渲染顺序与分组", () => {
  const list = renderToStaticMarkup(
    createElement(ResultList, { items: ["甲", "乙"] }),
  );
  assert.match(list, /甲/);
  assert.match(list, /乙/);
  assert.match(list, /01/);

  const groups = renderToStaticMarkup(
    createElement(GroupCards, { groups: [["甲", "乙"], ["丙"]] }),
  );
  assert.match(groups, /第 1 组/);
  assert.match(groups, /第 2 组/);
  assert.match(groups, /2 人/);
  assert.match(groups, /1 人/);
});

test("多次洗牌会产生多种排列", () => {
  const orders = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    orders.add(shuffle(["a", "b", "c", "d"]).join(""));
  }
  assert.ok(orders.size > 12, `只出现了 ${orders.size} 种排列`);
});

test("pickWinners 取洗牌结果的前 N 项且不修改输入", () => {
  const order = ["甲", "乙", "丙", "丁"];
  assert.deepEqual(pickWinners(order, 2), ["甲", "乙"]);
  assert.deepEqual(pickWinners(order, 4), order);
  assert.deepEqual(order, ["甲", "乙", "丙", "丁"]);
});

test("pickWinners 拒绝越界或非整数人数", () => {
  const order = ["甲", "乙", "丙"];
  for (const bad of [0, -1, 4, 1.5, Number.NaN]) {
    assert.throws(() => pickWinners(order, bad), /winnerCount 必须是 1 到条目数之间的整数/);
  }
});

test("28 人抽 12 人：中奖名单是洗牌前 12 项，且全部条目不重不漏", () => {
  const people = Array.from({ length: 28 }, (_, index) => `成员 ${String(index + 1).padStart(2, "0")}`);
  const seen = new Set<string>();
  for (let round = 0; round < 50; round += 1) {
    const order = shuffle(people);
    const winners = pickWinners(order, 12);
    assert.equal(winners.length, 12);
    assert.deepEqual(winners, order.slice(0, 12));
    // 中奖名单必须是原名单的子集，且组内不重复
    assert.equal(new Set(winners).size, 12);
    assert.ok(winners.every((person) => people.includes(person)));
    // 完整顺序覆盖全部 28 人，不重不漏
    assert.equal(order.length, 28);
    assert.deepEqual([...order].sort(), [...people].sort());
    seen.add(winners.join("|"));
  }
  // 12/28 的抽样空间极大，50 轮不该出现完全相同的排列
  assert.ok(seen.size > 40, `只出现了 ${seen.size} 种中奖组合`);
});
