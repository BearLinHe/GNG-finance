import assert from "node:assert/strict";
import test from "node:test";
import { priceDriverDays, type IncomeRule } from "../lib/oak-income";
import type { DriverTask } from "../lib/oak-driver-types";
import { csvCell, paymentBalance, settlementSnapshot, settlementTotals, settlementWeek, transportJobs, validateSettlement, workflowDate } from "../lib/oak-workflow";

function task(id: string, changes: Partial<DriverTask> = {}): DriverTask {
  return { id, importId: 1, sheetName: "甲", driverName: "甲", sourceRow: Number(id) + 2, section: "海柜", workDate: "2026-09-05", reference: `柜${id}`, nature: "MCE1直送", fromLocation: "HW", toLocation: "MCE1", miles: 89, notes: null, rawCells: { G3: 9999 }, ...changes };
}
const rule: IncomeRule = { id: 1, name: "MCE1收入", workLabel: "MCE1", amount: 506, billingBasis: "trip", active: true, fromLocation: null, toLocation: null, validFrom: null, validTo: null };
function rated() {
  const input = [task("1"), task("2", { nature: "空车", fromLocation: "MCE1", toLocation: "STK", miles: 50 }), task("3", { workDate: "2026-09-07", nature: null, fromLocation: "STK", toLocation: "HW", miles: 68 })];
  return priceDriverDays([{ driverName: "甲", workDate: "2026-09-05", taskCount: 2, miles: 139, tasks: input.slice(0, 2) }, { driverName: "甲", workDate: "2026-09-07", taskCount: 1, miles: 68, tasks: input.slice(2) }], [rule], ["2", "3"].map(taskId => ({ taskId, mode: "included" as const, workLabel: null, amount: null, includedTaskId: "1", note: "同一趟" })));
}
test("three cross-day legs form one 506-dollar task, preserving 207 source miles and each reference", () => {
  const tasks = rated().flatMap(day => day.tasks); const original = JSON.stringify(tasks); const jobs = transportJobs(tasks);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].amount, 506); assert.equal(jobs[0].miles, 207);
  assert.equal(jobs[0].dateTo, "2026-09-07"); assert.equal(jobs[0].legs.length, 3);
  assert.equal(JSON.stringify(tasks), original);
  const partial = transportJobs(tasks.slice(2)); assert.equal(partial[0].primary, null); assert.equal(partial[0].amount, null); assert.equal(partial[0].id, "1");
});
test("explicitly grouped equal trip labels charge the selected main leg once", () => {
  const tasks = [task("1"), task("2", { fromLocation: "MCE1", toLocation: "HW" })];
  const result = priceDriverDays([{ driverName: "甲", workDate: "2026-09-05", taskCount: 2, miles: 178, tasks }], [rule], [{ taskId: "2", mode: "included", workLabel: null, amount: null, includedTaskId: "1", note: "用户已确认同一收费业务" }]);
  assert.equal(result[0].revenue?.amount, 506); assert.equal(result[0].revenue?.pricedCount, 1); assert.equal(result[0].revenue?.includedCount, 1);
});
test("weekly periods always span Saturday through Friday, including year boundaries", () => {
  assert.deepEqual(settlementWeek("2026-10-27"), { start: "2026-10-24", end: "2026-10-30" });
  assert.deepEqual(settlementWeek("2026-10-24"), { start: "2026-10-24", end: "2026-10-30" });
  assert.deepEqual(settlementWeek("2026-10-30"), { start: "2026-10-24", end: "2026-10-30" });
  assert.deepEqual(settlementWeek("2026-01-01"), { start: "2025-12-27", end: "2026-01-02" });
  for (const value of ["", "2026-02-30", "2026-13-01", "0000-01-01", "26-01-01", undefined]) assert.throws(() => workflowDate(value));
});
test("weekly pay is manual base plus allowances minus deductions, never task income or Excel Driver cells", () => {
  const source = settlementSnapshot("甲", "2026-09-05", rated().flatMap(day => day.tasks));
  assert.equal(source.revenue.amount, 506); assert.equal(source.tasks[0].rawCells.G3, 9999);
  const input = validateSettlement({ subject: "甲", weekStart: "2026-09-05", payeeName: "车主甲", payeeType: "owner", baseAmount: "1000.10", adjustments: [{ kind: "allowance", title: "补贴", amount: "20.20" }, { kind: "deduction", title: "预支", amount: "10.01" }], note: "已核对约定报酬" });
  assert.deepEqual(settlementTotals(input), { baseAmount: 1000.1, allowance: 20.2, deduction: 10.01, totalAmount: 1010.29 });
  for (const change of [{ baseAmount: "" }, { baseAmount: -1 }, { payeeType: "both" }, { payeeName: "" }, { note: "" }, { weekStart: "2026-09-06" }, { adjustments: [{ kind: "deduction", title: "扣款", amount: 2000 }] }]) assert.throws(() => validateSettlement({ ...input, ...change }));
  assert.equal(validateSettlement({ ...input, baseAmount: 0, adjustments: [] }).baseAmount, 0);
});
test("snapshots reject wrong subject and out-of-week sources, and detach from future mutations", () => {
  const tasks = rated().flatMap(day => day.tasks); const snapshot = settlementSnapshot("甲", "2026-09-05", tasks);
  tasks[0].income!.amount = 999; tasks[0].rawCells.G3 = 1;
  assert.equal(snapshot.tasks[0].income?.amount, 506); assert.equal(snapshot.tasks[0].rawCells.G3, 9999);
  assert.throws(() => settlementSnapshot("乙", "2026-09-05", tasks));
  assert.throws(() => settlementSnapshot("甲", "2026-09-12", tasks)); assert.throws(() => settlementSnapshot("甲", "2026-09-05", []));
});
test("partial payments and voids reconcile in cents without deleting source records", () => {
  const payments = [{ amount: 0.1, voided: false }, { amount: 0.2, voided: false }, { amount: 100, voided: true }];
  assert.deepEqual(paymentBalance(1, payments), { paidAmount: 0.3, remaining: 0.7 }); assert.equal(payments.length, 3);
});
test("CSV exports neutralize formulas in untrusted names, references and notes", () => {
  for (const value of ["=HYPERLINK(1)", "+SUM(1)", "-1+2", "@SUM(A1)", "   =SUM(1)", "\ttext"]) assert.match(csvCell(value), /^"'/);
  assert.equal(csvCell('a,"b"'), '"a,""b"""'); assert.equal(csvCell(506), '"506"');
});
