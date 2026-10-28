import assert from "node:assert/strict";
import test from "node:test";
import { calculatePeriodProfit, profitTaskSignature, summarizePeriodProfits, validatePeriodCost, type PeriodCostReview, type ProfitScope, type ProfitSettlement } from "../lib/oak-period-profit";
import type { DriverTask } from "../lib/oak-driver-types";

const scope: ProfitScope = { subject: "司机甲", dateFrom: "2026-09-12", dateTo: "2026-09-18", importId: 1 };
const hash = "a".repeat(64);
function task(id = "1", changes: Partial<DriverTask> = {}): DriverTask {
  return { id, importId: 1, driverName: scope.subject, sheetName: scope.subject, section: "海柜", sourceRow: 3, workDate: "2026-09-14", nature: "TCY1", reference: "柜1", fromLocation: "SFO", toLocation: "95206", miles: 68, notes: null, rawCells: { G3: 99999 },
    income: { status: "priced", amount: 440, source: "rule", workLabel: "TCY1", ruleId: 1, basis: "收入", billingBasis: "trip", includedTaskId: null, review: null }, ...changes };
}
function settlement(changes: Partial<ProfitSettlement> = {}): ProfitSettlement {
  return { id: "1", subject: scope.subject, weekStart: scope.dateFrom, weekEnd: scope.dateTo, payeeType: "driver", baseAmount: 200, adjustments: [], status: "confirmed", taskIds: ["1"], ...changes };
}
function review(changes: Partial<PeriodCostReview> = {}): PeriodCostReview {
  return { ...scope, payeeType: "driver", laborMode: "settlements", laborAmount: null, expenses: [], expensesConfirmed: true, note: "已核对", taskHash: hash, version: 1, updatedAt: "2026-10-28", ...changes };
}
test("complete period profit deducts earned wages and vehicle expenses, not raw Excel pay cells", () => {
  const result = calculatePeriodProfit(scope, [task()], [settlement()], review({ expenses: [{ title: "油费", amount: 50.01 }] }), hash);
  assert.equal(result.laborAmount, 200); assert.equal(result.otherAmount, 50.01); assert.equal(result.net, 189.99); assert.equal(result.status, "profit");
});
test("missing pay or expense confirmation never becomes zero cost or a profitable result", () => {
  const missing = calculatePeriodProfit(scope, [task()], [], null, hash);
  assert.equal(missing.net, null); assert.equal(missing.laborAmount, null); assert.equal(missing.otherAmount, null); assert.equal(missing.status, "pending");
  const expenseMissing = calculatePeriodProfit(scope, [task()], [settlement()], null, hash);
  assert.equal(expenseMissing.laborAmount, 200); assert.equal(expenseMissing.net, null);
});
test("a partially priced period remains pending even if known income exceeds known costs", () => {
  const tasks = [task(), task("2", { income: undefined })];
  const result = calculatePeriodProfit(scope, tasks, [settlement({ taskIds: ["1", "2"] })], review(), hash);
  assert.equal(result.income.amount, 440); assert.equal(result.income.pendingCount, 1); assert.equal(result.net, null);
});
test("advance and repayment deductions do not artificially reduce labor cost", () => {
  const result = calculatePeriodProfit(scope, [task()], [settlement({ adjustments: [{ kind: "allowance", title: "补贴", amount: 20.20 }, { kind: "deduction", title: "还款", amount: 190 }] })], review(), hash);
  assert.equal(result.laborAmount, 220.2); assert.equal(result.net, 219.8);
});
test("partial week and batch subset do not receive an entire weekly wage", () => {
  for (const partial of [{ ...scope, dateFrom: "2026-09-14" }, scope]) {
    const result = calculatePeriodProfit(partial, [task()], [settlement(partial === scope ? { taskIds: ["1", "2"] } : {})], null, hash);
    assert.equal(result.laborAmount, null); assert.equal(result.net, null);
  }
});
test("drafts, other subjects, wrong identities and overlapping duplicates are not extra costs", () => {
  const result = calculatePeriodProfit(scope, [task()], [settlement(), settlement({ id: "2" }), settlement({ id: "3", status: "draft" }), settlement({ subject: "别人" }), settlement({ payeeType: "owner" })], review(), hash);
  assert.equal(result.laborAmount, 200); assert.equal(result.settlements.length, 1);
});
test("explicit manual pay supports arbitrary dates without adding weekly pay twice", () => {
  const partial = { ...scope, dateFrom: "2026-09-14" };
  const result = calculatePeriodProfit(partial, [task()], [settlement()], review({ ...partial, laborMode: "manual", laborAmount: 100 }), hash);
  assert.equal(result.laborAmount, 100); assert.equal(result.net, 340); assert.equal(result.status, "profit");
});
test("review fingerprints and exact date/import scope prevent reuse after source selection changes", () => {
  for (const changes of [{ taskHash: "b".repeat(64) }, { importId: null }, { dateFrom: "2026-09-13" }]) {
    const result = calculatePeriodProfit(scope, [task()], [settlement()], review({ laborMode: "manual", laborAmount: 1, ...changes }), hash);
    assert.equal(result.staleReview, true); assert.equal(result.otherAmount, null); assert.equal(result.net, null);
  }
});
test("owners use owner cost while conflicting role evidence blocks a profit verdict", () => {
  const ownerScope = { ...scope, subject: "O Don" }; const owner = task("1", { driverName: "O Don", sheetName: "O Don" });
  const result = calculatePeriodProfit(ownerScope, [owner], [settlement({ subject: "O Don", payeeType: "owner" })], review({ ...ownerScope, payeeType: "owner" }), hash);
  assert.equal(result.payeeType, "owner"); assert.equal(result.net, 240);
  const mixed = calculatePeriodProfit(scope, [task(), task("2", { payeeType: "owner" })], [], review({ laborMode: "manual", laborAmount: 10 }), hash);
  assert.equal(mixed.net, null); assert.match(mixed.issues.join(" "), /身份/);
});
test("multiple whole weeks add once and summaries contain complete subjects only, independent of pagination", () => {
  const wide = { ...scope, dateTo: "2026-09-25" };
  const tasks = [task(), task("2", { workDate: "2026-09-21" })];
  const result = calculatePeriodProfit(wide, tasks, [settlement(), settlement({ id: "2", weekStart: "2026-09-19", weekEnd: "2026-09-25", taskIds: ["2"], baseAmount: 300 })], review(wide), hash);
  assert.equal(result.laborAmount, 500); assert.equal(result.net, 380);
  const pending = calculatePeriodProfit(scope, [task()], [], null, hash);
  assert.deepEqual(summarizePeriodProfits([result, pending]), { completeCount: 1, pendingCount: 1, profitCount: 1, lossCount: 0, evenCount: 0, netAmount: 380, revenueAmount: 880, costAmount: 500 });
});
test("explicit zero pay and expenses are valid and cent arithmetic classifies losses and break-even", () => {
  for (const [pay, net, status] of [[0, 440, "profit"], [440, 0, "even"], [440.01, -0.01, "loss"]] as const) {
    const result = calculatePeriodProfit(scope, [task()], [], review({ laborMode: "manual", laborAmount: pay }), hash);
    assert.equal(result.net, net); assert.equal(result.status, status);
  }
});
test("period cost validation requires explicit zero and confirmation, bounded money and optimistic version", () => {
  const input = review({ laborMode: "manual", laborAmount: 0 }); assert.equal(validatePeriodCost(input).laborAmount, 0);
  for (const changes of [{ laborAmount: "" }, { laborAmount: -1 }, { expensesConfirmed: false }, { version: -1 }, { version: "1" }, { taskHash: "" }, { dateFrom: "2026-02-30" }, { expenses: [{ title: "油费", amount: 1.001 }] }, { note: "" }]) assert.throws(() => validatePeriodCost({ ...input, ...changes }));
});
test("scope fingerprints are stable under ordering and change when source roles or dates change", () => {
  assert.equal(profitTaskSignature([task(), task("2")]), profitTaskSignature([task("2"), task()]));
  assert.notEqual(profitTaskSignature([task()]), profitTaskSignature([task("1", { payeeType: "owner" })]));
});
