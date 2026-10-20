import assert from "node:assert/strict";
import test from "node:test";
import { emptyIncomeSummary, incomeAmount, incomeWorkLabel, normalizeIncomeText, normalizeIncomeWork, priceDriverDays, rulesOverlap, summarizeIncome, validateIncomeRule, type IncomeReview, type IncomeRule } from "../lib/oak-income";
import { summarizeDriverPeriods, type DriverDay, type DriverTask } from "../lib/oak-driver-types";

function task(id = "1", overrides: Partial<DriverTask> = {}): DriverTask {
  return { id, importId: 1, sheetName: "司机甲", section: "海柜", sourceRow: Number(id), driverName: "司机甲", workDate: "2026-09-01", reference: "TEST123", nature: "提柜", fromLocation: "ETS", toLocation: "SFO", miles: 21, notes: null, rawCells: { G3: 9999 }, ...overrides };
}
function day(tasks = [task()]): DriverDay { return { driverName: tasks[0].driverName, workDate: tasks[0].workDate, taskCount: tasks.length, miles: 42, tasks }; }
function rule(overrides: Partial<IncomeRule> = {}): IncomeRule { return { id: 1, name: "提柜收入", workLabel: "提柜", fromLocation: null, toLocation: null, amount: 120.35, billingBasis: "segment", validFrom: null, validTo: null, active: true, ...overrides }; }
function review(taskId: string, overrides: Partial<IncomeReview> = {}): IncomeReview { return { taskId, mode: "manual", amount: 200, workLabel: null, includedTaskId: null, note: "核对", ...overrides }; }

test("no income rules means pending, never worksheet Driver pay, transport costs or zero revenue", () => {
  const input = [day([task(), task("2", { nature: null })])]; const original = JSON.stringify(input);
  const rated = priceDriverDays(input, [], []);
  assert.deepEqual(rated[0].revenue, { amount: 0, pricedCount: 0, pendingCount: 2, includedCount: 0 });
  assert.equal(rated[0].tasks[0].income?.amount, null);
  assert.match(rated[0].tasks[1].income!.basis, /未注明作业/);
  assert.equal(JSON.stringify(input), original);
  assert.equal(incomeWorkLabel(task("3", { nature: null, reference: "空车" })), "空车");
  assert.equal(incomeWorkLabel(task("4", { nature: null, reference: "CONT123" })), null);
});
test("income matches work label and optional directed endpoints, never ZIP code alone", () => {
  const tasks = [task(), task("2", { nature: "TCY2直送", fromLocation: "SFO", toLocation: "95215" }), task("3", { nature: "SCK1直送", fromLocation: "SFO", toLocation: "95215" }), task("4", { nature: null, fromLocation: "95215", toLocation: "SFO" })];
  const rated = priceDriverDays([day(tasks)], [rule(), rule({ id: 2, workLabel: "TCY2直送", fromLocation: "sfo", toLocation: "95215", amount: 600 })], [])[0];
  assert.equal(rated.tasks[1].income?.amount, 600); assert.equal(rated.tasks[2].income?.amount, null); assert.equal(rated.tasks[3].income?.amount, null);
  assert.deepEqual(rated.revenue, { amount: 720.35, pricedCount: 2, pendingCount: 2, includedCount: 0 });
  assert.equal(normalizeIncomeText(" s f o "), "SFO");
});
test("warehouse income codes match direct-delivery labels without rewriting original work", () => {
  for (const code of ["TCY1", "TCY2", "SCK8", "SMF3"]) {
    assert.equal(normalizeIncomeWork(`${code}直送`), code);
    assert.equal(normalizeIncomeWork(` ${code.toLowerCase()} 直送 `), code);
    const input = [day([task("1", { nature: `${code}直送`, fromLocation: "SFO", toLocation: "95206" })])];
    const before = JSON.stringify(input);
    const incomeRule = rule({ workLabel: code, amount: 440, billingBasis: "trip" });
    const rated = priceDriverDays(input, [incomeRule], []);
    assert.equal(rated[0].tasks[0].income?.amount, 440);
    assert.match(rated[0].tasks[0].income!.basis, /440\.00/);
    assert.equal(rated[0].tasks[0].nature, `${code}直送`);
    assert.equal(JSON.stringify(input), before);
    assert.equal(priceDriverDays([day([task("1", { nature: code })])], [rule({ workLabel: `${code}直送`, amount: 440 })], [])[0].revenue?.amount, 440);
  }
  assert.equal(normalizeIncomeWork("ＴＣＹ１直送"), "TCY1");
});
test("warehouse aliases never cross codes or service types, and still respect route, date and active filters", () => {
  const incomeRule = rule({ workLabel: "TCY1", fromLocation: "SFO", toLocation: "95206", amount: 440, validFrom: "2026-09-01", validTo: "2026-09-30" });
  for (const nature of ["TCY2直送", "TCY10直送", "TCY1自提", "TCY1卡派", "TCY1直送拒收", "TCY1直送+TCY2直送", "送仓TCY1", null]) {
    assert.equal(priceDriverDays([day([task("1", { nature, fromLocation: "SFO", toLocation: "95206" })])], [incomeRule], [])[0].tasks[0].income?.amount, null);
  }
  for (const changes of [{ fromLocation: "ETS" }, { toLocation: "95215" }, { workDate: "2026-08-31" }, { workDate: "2026-10-01" }]) {
    assert.equal(priceDriverDays([day([task("1", { nature: "TCY1直送", fromLocation: "SFO", toLocation: "95206", ...changes })])], [incomeRule], [])[0].tasks[0].income?.amount, null);
  }
  assert.equal(priceDriverDays([day([task("1", { nature: "TCY1直送" })])], [rule({ workLabel: "TCY1", active: false })], [])[0].revenue?.pricedCount, 0);
});
test("equivalent warehouse labels share overlap/conflict checks and trip duplicate protection", () => {
  const warehouseRule = rule({ workLabel: "TCY1", amount: 440, billingBasis: "trip" });
  assert.equal(rulesOverlap(warehouseRule, rule({ workLabel: "TCY1直送" })), true);
  assert.equal(rulesOverlap(warehouseRule, rule({ workLabel: "TCY1自提" })), false);
  const conflict = priceDriverDays([day([task("1", { nature: "TCY1直送" })])], [warehouseRule, rule({ id: 2, workLabel: "TCY1直送", amount: 500 })], [])[0];
  assert.equal(conflict.tasks[0].income?.status, "conflict"); assert.equal(conflict.revenue?.pricedCount, 0);
  const tasks = [task("1", { nature: "TCY1直送", fromLocation: "SFO", toLocation: "95206" }), task("2", { nature: "TCY1", fromLocation: "95206", toLocation: "SFO" })];
  assert.equal(priceDriverDays([day(tasks)], [warehouseRule], [])[0].revenue?.pendingCount, 2);
  const rated = priceDriverDays([day(tasks)], [warehouseRule], [review("1", { amount: 440 }), review("2", { mode: "included", amount: null, includedTaskId: "1" })])[0];
  assert.deepEqual(rated.revenue, { amount: 440, pricedCount: 1, pendingCount: 0, includedCount: 1 });
});
test("most specific route wins, same-priority matches stay unresolved", () => {
  const rules = [rule(), rule({ id: 2, fromLocation: "ETS", amount: 150 }), rule({ id: 3, fromLocation: "ETS", toLocation: "SFO", amount: 180 })];
  assert.equal(priceDriverDays([day()], rules, [])[0].tasks[0].income?.amount, 180);
  const conflict = priceDriverDays([day()], [...rules, rule({ id: 4, fromLocation: "ETS", toLocation: "SFO", amount: 200 })], [])[0];
  assert.equal(conflict.tasks[0].income?.status, "conflict"); assert.equal(conflict.revenue?.amount, 0); assert.equal(conflict.revenue?.pendingCount, 1);
});
test("effective dates are inclusive; inactive prices and historical changes do not leak into other dates", () => {
  const rules = [rule({ validFrom: "2026-09-01", validTo: "2026-09-30" }), rule({ id: 2, amount: 200, validFrom: "2026-10-01" }), rule({ id: 3, active: false })];
  const income = (date: string) => priceDriverDays([day([task("1", { workDate: date })])], rules, [])[0].tasks[0].income;
  assert.equal(income("2026-08-31")?.status, "pending"); assert.equal(income("2026-09-01")?.amount, 120.35);
  assert.equal(income("2026-09-30")?.amount, 120.35); assert.equal(income("2026-10-01")?.amount, 200);
});
test("return legs require explicit inclusion and contribute no second revenue", () => {
  const tasks = [task(), task("2", { nature: null, fromLocation: "SFO", toLocation: "ETS" })];
  const rules = [rule({ billingBasis: "trip" })];
  assert.equal(priceDriverDays([day(tasks)], rules, [])[0].revenue?.pendingCount, 1);
  const rated = priceDriverDays([day(tasks)], rules, [review("2", { mode: "included", amount: null, includedTaskId: "1" })])[0];
  assert.deepEqual(rated.revenue, { amount: 120.35, pricedCount: 1, pendingCount: 0, includedCount: 1 });
  assert.equal(rated.tasks[1].income?.source, "included");
  assert.equal(priceDriverDays([day(tasks)], [], [review("2", { mode: "included", amount: null, includedTaskId: "1" })])[0].revenue?.pendingCount, 2);
  assert.equal(priceDriverDays([day(tasks)], [rule()], [review("2", { mode: "included", amount: null, includedTaskId: "1" })])[0].tasks[1].income?.status, "pending");
});
test("repeated trip labels do not automatically charge every leg, even after one main job is confirmed", () => {
  const tasks = [task(), task("2", { fromLocation: "SFO", toLocation: "ETS" })]; const rules = [rule({ billingBasis: "trip" })];
  assert.equal(priceDriverDays([day(tasks)], rules, [])[0].revenue?.pricedCount, 0);
  const manual = review("1", { amount: 120.35 });
  assert.equal(priceDriverDays([day(tasks)], rules, [manual])[0].revenue?.pendingCount, 1);
  const rated = priceDriverDays([day(tasks)], rules, [manual, review("2", { mode: "included", amount: null, includedTaskId: "1" })])[0];
  assert.deepEqual(rated.revenue, { amount: 120.35, pricedCount: 1, pendingCount: 0, includedCount: 1 });
});
test("inclusions reject self, different drivers, imports, and chains", () => {
  for (const changes of [{ driverName: "乙" }, { importId: 2 }]) {
    const result = priceDriverDays([day([task(), task("2", changes)])], [], [review("1"), review("2", { mode: "included", amount: null, includedTaskId: "1" })]);
    assert.equal(result[0].tasks[1].income?.status, "pending");
  }
  assert.equal(priceDriverDays([day()], [], [review("1", { mode: "included", amount: null, includedTaskId: "1" })])[0].tasks[0].income?.status, "pending");
  const result = priceDriverDays([day([task(), task("2"), task("3")])], [], [review("1"), review("2", { mode: "included", amount: null, includedTaskId: "1" }), review("3", { mode: "included", amount: null, includedTaskId: "2" })]);
  assert.equal(result[0].tasks[1].income?.status, "included"); assert.equal(result[0].tasks[2].income?.status, "pending");
});
test("cross-day returns keep income on the main workday, not the return day", () => {
  const firstDay = day([task()]); const returnDay = day([task("2", { workDate: "2026-09-09", nature: null, fromLocation: "SFO", toLocation: "ETS" })]);
  const result = priceDriverDays([firstDay, returnDay], [rule({ billingBasis: "trip" })], [review("2", { mode: "included", amount: null, includedTaskId: "1" })]);
  assert.equal(result[0].revenue?.amount, 120.35); assert.equal(result[1].revenue?.amount, 0); assert.equal(result[1].revenue?.includedCount, 1);
  assert.match(result[1].tasks[0].income!.basis, /2026-09-01/);
});
test("manual income, explicit zero and confirmed labels preserve source work and decimal totals", () => {
  const tasks = [task("1", { nature: null }), task("2"), task("3")];
  const rated = priceDriverDays([day(tasks)], [rule()], [review("1", { mode: "label", workLabel: "提柜", amount: null }), review("2", { amount: 0 }), review("3", { amount: 0.1 })])[0];
  assert.equal(rated.tasks[0].nature, null); assert.equal(rated.tasks[0].income?.amount, 120.35);
  assert.equal(rated.tasks[1].income?.amount, 0); assert.equal(rated.revenue?.amount, 120.45); assert.equal(rated.revenue?.pendingCount, 0);
});
test("period and day summaries reconcile without treating missing revenue as zero-priced", () => {
  const days = priceDriverDays([day([task(), task("2", { nature: null })]), day([task("3", { workDate: "2026-09-02" })])], [rule({ amount: 0.1 })], []);
  const periods = summarizeDriverPeriods(days);
  assert.deepEqual(periods[0].revenue, { amount: 0.2, pricedCount: 2, pendingCount: 1, includedCount: 0 });
  assert.deepEqual(summarizeIncome(days.flatMap(value => value.tasks)), periods[0].revenue);
  assert.deepEqual(summarizeIncome([]), emptyIncomeSummary());
});
test("income validation rejects blank, negative, invalid dates and precision; accepts explicit zero", () => {
  for (const value of ["", " ", null, true, -1, "1.234", "1e3", Infinity, "10000000000"]) assert.throws(() => incomeAmount(value));
  assert.equal(incomeAmount("0"), 0); assert.equal(incomeAmount("120.35"), 120.35);
  for (const changes of [{ name: "" }, { workLabel: "" }, { validFrom: "2026-02-30" }, { validFrom: "2026-09-02", validTo: "2026-09-01" }, { active: "true" }, { billingBasis: "expense" }]) assert.throws(() => validateIncomeRule({ ...rule(), ...changes }));
  assert.equal(validateIncomeRule(rule()).amount, 120.35);
  assert.equal(rulesOverlap(rule({ validTo: "2026-09-30" }), rule({ validFrom: "2026-10-01" })), false);
  assert.equal(rulesOverlap(rule(), rule({ workLabel: " 提 柜 " })), true);
  assert.equal(rulesOverlap(rule(), rule({ fromLocation: "ETS" })), false);
  assert.equal(rulesOverlap(rule(), rule({ active: false })), false);
});
