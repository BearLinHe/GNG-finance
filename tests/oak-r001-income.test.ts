import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDriverTasks, type DriverTask } from "../lib/oak-driver-types";
import { priceDriverDays, summarizeIncome, type IncomeReview, type IncomeRule } from "../lib/oak-income";
import { oakVehicleSeeds } from "../lib/oak-vehicles";

const rule: IncomeRule = {
  id: 20, name: "大华 R001", workLabel: "R001", fromLocation: null, toLocation: null,
  amount: 1500, billingBasis: "trip", validFrom: null, validTo: null, active: true,
};
const date = "2026-08-24";
const route = (stops: string[], overrides: Partial<DriverTask> = {}): DriverTask[] =>
  stops.slice(1).map((toLocation, i) => ({
    id: String(i + 1), importId: 10, sheetName: "Jay D", section: "海柜", sourceRow: i + 5,
    driverName: "Jay D", workDate: date, reference: "R001", nature: null, fromLocation: stops[i],
    toLocation, miles: 10, notes: null, rawCells: {}, ...overrides,
  }));
const standard = ["94587", "95823", "95630", "94587"];
const rate = (tasks: DriverTask[], rules = [rule], reviews: IncomeReview[] = []) =>
  priceDriverDays(summarizeDriverTasks(tasks), rules, reviews, oakVehicleSeeds).flatMap(day => day.tasks);

test("0527 R001 counts one trip from either allowed departure and allows extra continuous stops", () => {
  for (const stops of [standard, ["SFO", ...standard.slice(1)], ["94587", "94804", ...standard.slice(1)]]) {
    const original = route(stops);
    const rated = rate([...original].reverse());
    const anchor = rated.find(task => task.id === "1")!;
    assert.equal(anchor.income?.amount, 1500);
    assert.equal(anchor.income?.billingBasis, "trip");
    assert.equal(anchor.income?.workLabel, "R001");
    assert.equal(anchor.nature, null);
    assert.ok(rated.filter(task => task.id !== "1").every(task => task.income?.status === "included" && task.income.includedTaskId === "1"));
    assert.deepEqual(summarizeIncome(rated), { amount: 1500, pricedCount: 1, includedCount: rated.length - 1, pendingCount: 0 });
    assert.ok(original.every(task => !task.income));
  }
});

test("0527 R001 separate returns to base can count separate trips", () => {
  const two = route([...standard, ...standard.slice(1)]);
  const rated = rate(two);
  assert.deepEqual(rated.filter(task => task.income?.status === "priced").map(task => task.id), ["1", "4"]);
  assert.equal(summarizeIncome(rated).amount, 3000);
});

test("R001 automation does not extend to other vehicles or reference codes", () => {
  for (const change of [{ driverName: "张晓澄" }, { driverName: "Unlinked" }, { reference: "R002" }]) {
    assert.equal(summarizeIncome(rate(route(standard, change))).pendingCount, 3);
  }
});

test("incomplete, broken, cross-day, or ambiguous source routes do not auto-price", () => {
  const first = route(standard);
  for (const tasks of [
    first.slice(0, 2),
    route(["SFO", "95823", "95630", "SFO"]),
    [first[0], { ...first[1], fromLocation: "95215" }, first[2]],
    [first[0], first[1], { ...first[2], sourceRow: 8 }],
    [first[0], first[1], { ...first[2], workDate: "2026-08-25" }],
    [first[0], first[1], { ...first[2], section: "Local" }],
    [...first, ...first.map(task => ({ ...task, importId: 11, id: `1${task.id}` }))],
  ]) {
    assert.equal(summarizeIncome(rate(tasks)).pricedCount, 0);
  }
});

test("R001 uses the configured rate and respects activation, dates, and conflicting trip rules", () => {
  const tasks = route(standard);
  assert.equal(summarizeIncome(rate(tasks, [{ ...rule, amount: 1725.50 }])).amount, 1725.50);
  for (const rules of [
    [{ ...rule, active: false }], [{ ...rule, validFrom: "2026-08-25" }],
    [{ ...rule, billingBasis: "segment" as const }], [rule, { ...rule, id: 21 }],
  ]) {
    assert.equal(summarizeIncome(rate(tasks, rules)).pricedCount, 0);
  }
});

test("an existing manual charge on another leg prevents an additional auto charge", () => {
  const override: IncomeReview = { taskId: "2", mode: "manual", amount: 1300, workLabel: null, includedTaskId: null, note: "核对" };
  const rated = rate(route(standard), [rule], [override]);
  assert.equal(summarizeIncome(rated).amount, 1300);
  assert.deepEqual(rated[1].income?.review, override);
  assert.equal(rated[0].income?.status, "pending");
});

test("a reviewed inclusion of the same R001 anchor retains its review and the trip rate", () => {
  const review: IncomeReview = { taskId: "3", mode: "included", amount: null, workLabel: null, includedTaskId: "1", note: "回程" };
  const rated = rate(route(standard), [rule], [review]);
  assert.equal(summarizeIncome(rated).amount, 1500);
  assert.equal(summarizeIncome(rated).includedCount, 2);
  assert.deepEqual(rated[2].income?.review, review);
});
