import assert from "node:assert/strict";
import test from "node:test";
import { driverPagination, paginateDriverPeriods } from "../lib/oak-pagination";

test("driver pagination defaults to 100 and accepts the 300-row maximum", () => {
  assert.deepEqual(driverPagination(new URLSearchParams()), { page: 1, pageSize: 100 });
  assert.deepEqual(driverPagination(new URLSearchParams("page=2&pageSize=300")), { page: 2, pageSize: 300 });
});
test("invalid numbers never produce Infinity, null or fractional page results", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "1.5", "abc", "9007199254740992"]) {
    assert.throws(() => driverPagination(new URLSearchParams({ page: value })));
  }
  for (const value of ["9", "301", "Infinity", "50.5", "abc"]) assert.throws(() => driverPagination(new URLSearchParams({ pageSize: value })));
});
test("all pages retain stable non-overlapping driver groups, including the final partial page", () => {
  const input = Array.from({ length: 321 }, (_, index) => ({ name: `车辆${index + 1}`, days: [1, 2, 3] }));
  for (const size of [50, 100, 300]) {
    const pages = Array.from({ length: Math.ceil(input.length / size) }, (_, index) => paginateDriverPeriods(input, index + 1, size));
    assert.deepEqual(pages.flatMap(page => page.periods), input);
    assert.equal(new Set(pages.flatMap(page => page.periods.map(item => item.name))).size, 321);
    assert.equal(pages.at(-1)!.periods.length, 21);
  }
});
test("shrinking results or an oversized page returns the last valid page, never a phantom empty page", () => {
  assert.deepEqual(paginateDriverPeriods(["车辆甲"], 4, 100), { periods: ["车辆甲"], page: 1, pageSize: 100, totalCount: 1 });
  const input = Array.from({ length: 101 }, (_, i) => i);
  assert.deepEqual(paginateDriverPeriods(input, Number.MAX_SAFE_INTEGER, 100).periods, [100]);
  assert.equal(paginateDriverPeriods(input, 99, 100).page, 2);
  assert.deepEqual(paginateDriverPeriods([], 99, 100), { periods: [], page: 1, pageSize: 100, totalCount: 0 });
});
