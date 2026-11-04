import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUniqueVehicleLinks, oakVehicleSeeds, vehicleForSubject, vehicleSubjectKey } from "../lib/oak-vehicles";
import { calculateVehicleAccounting, defaultVehicleEntries, isVehicleAccountingView, validateVehicleAccounting, vehicleAccountingViews, vehicleRange, vehicleViewLabels, type VehicleAccountingReview } from "../lib/oak-vehicle-accounting";
import type { DriverTask } from "../lib/oak-driver-types";
import type { ProfitSettlement } from "../lib/oak-period-profit";

const vehicle = oakVehicleSeeds[4];
const range = { dateFrom: "2026-10-03", dateTo: "2026-10-09" };
const hash = "a".repeat(64);
test("five category views including fuel map to the main-table accounting fields", () => {
  assert.deepEqual(vehicleAccountingViews, ["vehicles", "maintenance", "labor", "insurance", "fuel", "income"]);
  const entries = defaultVehicleEntries();
  for (const view of vehicleAccountingViews.filter(view => view !== "vehicles")) assert.ok(view in entries);
  assert.deepEqual(vehicleAccountingViews.slice(1).map(view => vehicleViewLabels[view]), ["维修费", "司机工资", "车辆保险", "油费", "车辆收入"]);
  assert.equal(isVehicleAccountingView("jobs"), false);
  assert.equal(isVehicleAccountingView("labor"), true);
});
const task = (id = "1", subject = "张晓澄"): DriverTask => ({ id, driverName: subject, sheetName: subject, payeeType: "driver", section: "海柜", sourceRow: 3,
  workDate: "2026-10-03", reference: "trailer 1", nature: "TCY1", fromLocation: "SFO", toLocation: "95206", miles: 68, notes: null, rawCells: {},
  income: { status: "priced", amount: 1000, workLabel: "TCY1", source: "manual", basis: "人工核定", billingBasis: "trip", ruleId: null, review: null, includedTaskId: null } });
const settlement = (subject = "张晓澄"): ProfitSettlement => ({ id: "1", subject, weekStart: range.dateFrom, weekEnd: range.dateTo, payeeType: "driver", baseAmount: 300,
  adjustments: [{ kind: "allowance", title: "补贴", amount: 20 }, { kind: "deduction", title: "预支", amount: 100 }], status: "confirmed", taskIds: ["1"] });
function review(): VehicleAccountingReview {
  const entries = defaultVehicleEntries();
  entries.fuel.amount = 100; entries.maintenance.amount = 50; entries.insurance.amount = 30;
  return { ...range, vehicleId: vehicle.id, entries, payeeType: "driver", otherExpenses: [{ title: "过桥费", amount: 10 }], note: "核对单据",
    sourceHash: hash, version: 1, updatedAt: "2026-11-02" };
}
test("vehicle roster preserves all 26 distinct records and leading zeroes", () => {
  assert.equal(oakVehicleSeeds.length, 26); assert.equal(new Set(oakVehicleSeeds.map(v => v.id)).size, 26);
  assert.equal(oakVehicleSeeds.filter(v => v.vehicleNumber == null).length, 2);
  for (const number of ["007", "0527", "0608"]) assert.ok(oakVehicleSeeds.some(v => v.vehicleNumber === number));
  assertUniqueVehicleLinks(oakVehicleSeeds);
});
test("confirmed Don and Jay D aliases map to the correct vehicles", () => {
  assert.equal(vehicleForSubject(oakVehicleSeeds, "O Don")?.vehicleNumber, "168");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "Jay D")?.vehicleNumber, "0527");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "O MARCO")?.vehicleNumber, "19");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "Luke")?.vehicleNumber, "0608");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "0608")?.vehicleNumber, "0608");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "薛艳明")?.vehicleNumber, "3183");
  assert.equal(vehicleForSubject(oakVehicleSeeds, "O 薛艳明")?.driverName, "薛彦明");
});
test("unknown and ignored source subjects are never guessed", () => {
  for (const name of ["Sam", "YONG", "O 韩涛", "王勇"]) assert.equal(vehicleForSubject(oakVehicleSeeds, name), null);
  assert.notEqual(vehicleSubjectKey("007"), vehicleSubjectKey("7"));
});
test("source links cannot be assigned to two vehicles", () => {
  const copy = oakVehicleSeeds.map(v => ({ ...v, aliases: [...v.aliases] }));
  copy[0].aliases.push("O Don"); assert.throws(() => assertUniqueVehicleLinks(copy), /已关联/);
  assert.equal(vehicleForSubject(copy, "O Don"), null);
});
test("automatic income and gross weekly labor combine with separate costs", () => {
  const result = calculateVehicleAccounting(vehicle, range, [task()], [settlement()], review(), hash);
  assert.equal(result.lines.income.amount, 1000); assert.equal(result.lines.labor.amount, 320);
  assert.equal(result.totalCost, 510); assert.equal(result.net, 490); assert.equal(result.status, "profit");
  assert.equal(result.lines.fuel.amount, 100); assert.equal(result.lines.insurance.source, "manual");
});
test("unknown vehicle costs do not become zero", () => {
  const result = calculateVehicleAccounting(vehicle, range, [task()], [settlement()], null, hash);
  assert.equal(result.net, null); assert.equal(result.lines.fuel.amount, null); assert.equal(result.totalCost, null);
});
test("explicit zero cost and loss and break-even work correctly", () => {
  const r = review(); for (const key of ["fuel", "maintenance", "insurance"] as const) r.entries[key].amount = 0;
  r.otherExpenses = []; r.entries.labor = { mode: "manual", amount: 1200 };
  assert.equal(calculateVehicleAccounting(vehicle, range, [task()], [], r, hash).net, -200);
  r.entries.labor.amount = 1000;
  assert.equal(calculateVehicleAccounting(vehicle, range, [task()], [], r, hash).status, "even");
});
test("manual period income replaces rather than adds to calculated income", () => {
  const r = review(); r.entries.income = { mode: "manual", amount: 2000 }; r.entries.labor = { mode: "manual", amount: 500 };
  const result = calculateVehicleAccounting(vehicle, range, [task()], [], r, hash);
  assert.equal(result.net, 1310); assert.equal(result.lines.income.source, "manual");
});
test("partial-week selection never prorates weekly wages silently", () => {
  const result = calculateVehicleAccounting(vehicle, { ...range, dateFrom: "2026-10-04" }, [{ ...task(), workDate: "2026-10-05" }], [settlement()], null, hash);
  assert.equal(result.autoLabor, null); assert.equal(result.lines.labor.amount, null);
});
test("restoring automatic labor uses its settlement identity, not an earlier manual identity", () => {
  const r = review(); r.payeeType = "owner";
  const result = calculateVehicleAccounting(vehicle, range, [task()], [settlement()], r, hash);
  assert.equal(result.payeeType, "driver"); assert.equal(result.autoPayeeType, "driver");
  r.entries.labor = { mode: "manual", amount: 500 };
  assert.equal(calculateVehicleAccounting(vehicle, range, [task()], [], r, hash).payeeType, "owner");
});
test("multiple source subjects use each distinct confirmed settlement once", () => {
  const r = review(); const other = { ...settlement("Luke"), id: "2", taskIds: ["2"] };
  const result = calculateVehicleAccounting(vehicle, range, [task(), task("2", "Luke")], [settlement(), other], r, hash);
  assert.equal(result.autoLabor, 640); assert.equal(result.autoIncome, 2000);
});
test("pending income remains unknown until manually verified", () => {
  const pending = { ...task(), income: undefined };
  const result = calculateVehicleAccounting(vehicle, range, [pending], [], review(), hash);
  assert.equal(result.autoIncome, null); assert.equal(result.net, null);
});
test("source changes invalidate old manual amounts", () => {
  const result = calculateVehicleAccounting(vehicle, range, [task()], [settlement()], review(), "b".repeat(64));
  assert.equal(result.stale, true); assert.equal(result.lines.fuel.amount, null); assert.equal(result.net, null);
});
test("different vehicle or period never reuses another scope's manual amounts", () => {
  const r = review(); r.vehicleId = "other";
  assert.equal(calculateVehicleAccounting(vehicle, range, [task()], [], r, hash).stale, true);
  r.vehicleId = vehicle.id; r.dateTo = "2026-10-10";
  assert.equal(calculateVehicleAccounting(vehicle, range, [task()], [], r, hash).net, null);
});
test("two unnumbered drivers remain incomplete until a vehicle number is supplied", () => {
  const v = oakVehicleSeeds[23]; const r = review(); r.vehicleId = v.id;
  r.entries.income = { mode: "manual", amount: 1000 }; r.entries.labor = { mode: "manual", amount: 100 };
  const result = calculateVehicleAccounting(v, range, [], [], r, hash);
  assert.equal(result.net, null); assert.ok(result.issues.includes("车号待补充"));
});
test("period input accepts incomplete drafts but requires evidence for actual manual values", () => {
  const input = { ...review(), entries: defaultVehicleEntries(), otherExpenses: [], note: "" };
  assert.equal(validateVehicleAccounting(input).entries.fuel.amount, null);
  input.entries.fuel.amount = 0; assert.throws(() => validateVehicleAccounting(input), /必填/);
  input.note = "无油费"; assert.equal(validateVehicleAccounting(input).entries.fuel.amount, 0);
});
test("invalid dates, money, version, and unsupported automatic expenses are rejected", () => {
  assert.throws(() => vehicleRange({ dateFrom: "2026-02-30", dateTo: "2026-10-09" }));
  assert.throws(() => vehicleRange({ dateFrom: "2026-10-10", dateTo: "2026-10-09" }));
  const r = review(); r.entries.fuel.amount = -1; assert.throws(() => validateVehicleAccounting(r));
  r.entries.fuel.amount = 1.001; assert.throws(() => validateVehicleAccounting(r));
  r.entries.fuel = { mode: "auto", amount: null }; assert.throws(() => validateVehicleAccounting(r), /自动数据/);
});
