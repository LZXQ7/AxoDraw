import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { GroupCards, ResultList } from "../src/components/result-view";
import { cryptoRandomInt, shuffle, shuffleWith } from "../src/lib/shuffle";

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
