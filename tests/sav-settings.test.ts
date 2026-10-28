import assert from "node:assert/strict";
import test from "node:test";
import { defaultSavSettings, mergeSavSettings, savDate } from "../lib/sav-settings";

test("SAV overrides preserve zero, require reasons and restore source when deleted", () => {
  const settings = mergeSavSettings(defaultSavSettings(), { incomeOverrides: { "12": { amount: 0, note: "已核对免费" } }, tripOverrides: { T001: { miles: 0, note: "同址" } } });
  assert.equal(settings.incomeOverrides["12"].amount, 0);
  assert.equal(settings.tripOverrides.T001.miles, 0);
  assert.deepEqual(mergeSavSettings(settings, { incomeOverrides: { "12": null } }).incomeOverrides, {});
  assert.equal(settings.incomeOverrides["12"].amount, 0);
  assert.throws(() => mergeSavSettings(settings, { incomeOverrides: { "12": { amount: 10, note: "" } } }));
});
test("all-order and Excel-scope income reviews save and reset independently", () => {
  const settings = mergeSavSettings(defaultSavSettings(), { incomeOverrides: { "12": { amount: 10, note: "派送出库" } }, allIncomeOverrides: { "12": { amount: 300, note: "全账单" } } });
  const updated = mergeSavSettings(settings, { allIncomeOverrides: { "12": null } });
  assert.deepEqual(updated.allIncomeOverrides, {});
  assert.equal(updated.incomeOverrides["12"].amount, 10);
});
test("SAV validation rejects nonfinite values, wrong fields and invalid dates", () => {
  for (const value of [NaN, Infinity, -1, "4.3", null]) assert.throws(() => mergeSavSettings(defaultSavSettings(), { pricing: { perMile: value } }));
  assert.throws(() => mergeSavSettings(defaultSavSettings(), { pricing: { roundingUnit: 0 } }));
  assert.throws(() => mergeSavSettings(defaultSavSettings(), { pricing: { toString: 4 } }));
  assert.throws(() => mergeSavSettings(defaultSavSettings(), { tripOverrides: { T001: { stopCount: 1.5, note: "核对" } } }));
  assert.throws(() => mergeSavSettings(defaultSavSettings(), { baseline: {} }));
  assert.throws(() => savDate("2026-02-30", "2026-01-01"));
  assert.equal(savDate(null, "2026-01-01"), "2026-01-01");
});
test("SAV manually confirmed return and pickup keep provenance and restore independently", () => {
  const settings = mergeSavSettings(defaultSavSettings(), { goodsOverrides: { "stock:1257": { status: "returned", note: "整柜退运，来源Excel在库与退运" }, "stock:12": { status: "transport", method: "自提", note: "已提走" } } });
  assert.equal(settings.goodsOverrides["stock:1257"].status, "returned");
  assert.equal(settings.goodsOverrides["stock:12"].method, "自提");
  assert.throws(() => mergeSavSettings(settings, { goodsOverrides: { "stock:12": { status: "transport", method: "fake", note: "核对" } } }));
  assert.deepEqual(mergeSavSettings(settings, { goodsOverrides: { "stock:1257": null } }).goodsOverrides, { "stock:12": { status: "transport", method: "自提", note: "已提走" } });
});
