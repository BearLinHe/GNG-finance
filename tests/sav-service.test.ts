import assert from "node:assert/strict";
import test from "node:test";
import { applySavSettings } from "../lib/sav-accounting-service";
import { defaultSavSettings } from "../lib/sav-settings";
import { calculateSavAccounting } from "../lib/sav-accounting";
import type { SavAccountingInput } from "../lib/sav-accounting-types";

function input(): SavAccountingInput { return {
  containers: [{ id: "1", containerNumber: "C1", customerName: null, pickupDate: null }],
  goods: [{ id: "10", containerId: "1", tripId: "t1", loadedPallets: 2, rejectedPallets: 0, status: "transport", method: "私仓" }],
  trips: [{ id: "t1", miles: null, stopCount: 1 }],
  incomeLines: [{ id: "100", containerId: "1", category: "delivery", amount: 300, label: "派送费" }]
}; }
test("saved Excel mileage is ignored if current complete trip membership changed", () => {
  const settings = defaultSavSettings();
  settings.tripOverrides.t1 = { miles: 100, goodsIds: ["10"], note: "基准" };
  assert.equal(applySavSettings(input(), settings).trips[0].miles, 100);
  const changed = input(); changed.goods.push({ ...changed.goods[0], id: "11", containerId: "outside" });
  const applied = applySavSettings(changed, settings);
  assert.equal(applied.trips[0].miles, null);
  assert.equal(calculateSavAccounting(applied).rows[0].expense, null);
});
test("Excel fallback yields to newly filled CoreFlow inputs while explicit manual reviews keep priority", () => {
  const settings = defaultSavSettings();
  settings.tripOverrides.t1 = { miles: 100, goodsIds: ["10"], calibratedFields: ["miles"], note: "Excel补齐" };
  const updated = input(); updated.trips[0].miles = 120;
  assert.equal(applySavSettings(updated, settings).trips[0].miles, 120);
  settings.tripOverrides.t1 = { miles: 130, note: "人工核对最新里程" };
  assert.equal(applySavSettings(updated, settings).trips[0].miles, 130);
});
test("manual confirmed zero income replaces source without double counting and a pickup status can be priced", () => {
  const settings = defaultSavSettings();
  settings.incomeOverrides["1"] = { amount: 0, note: "已确认免费" };
  settings.goodsOverrides["10"] = { status: "transport", method: "自提", note: "已自提" };
  const applied = applySavSettings(input(), settings);
  const result = calculateSavAccounting(applied).rows[0];
  assert.equal(result.income, 0); assert.equal(result.expense, 20); assert.equal(result.profit, -20);
  assert.equal(result.incomeLines.find(line => line.id === "100")?.category, "excluded");
  assert.match(result.goods[0].sourceReference || "", /已自提/);
});
test("Excel income reviews cannot replace all-order bill totals and scope reviews remain independent", () => {
  const settings = defaultSavSettings();
  settings.incomeOverrides["1"] = { amount: 0, note: "只确认派送出库免费" };
  const source = input(); source.incomeLines.push({ id: "101", containerId: "1", category: "other", amount: 500, label: "提拆费" });
  const all = calculateSavAccounting(applySavSettings(source, settings, "all")).rows[0];
  assert.equal(all.knownIncome, 800);
  assert.equal(all.accountingScope, "all");
  settings.allIncomeOverrides["1"] = { amount: 750, note: "全账单核对" };
  assert.equal(calculateSavAccounting(applySavSettings(source, settings, "all")).rows[0].income, 750);
  assert.equal(calculateSavAccounting(applySavSettings(source, settings, "excel")).rows[0].income, 0);
});
