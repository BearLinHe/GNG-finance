import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseSavBaseline, reconcileSav } from "../lib/sav-baseline";
import { calculateSavAccounting } from "../lib/sav-accounting";
import type { SavBaseline } from "../lib/sav-settings";

async function file(workbook: ExcelJS.Workbook, name = "核对.xlsx") {
  return { name, bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) };
}

function profitBook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("柜号汇总");
  sheet.addRow(["柜号", "提柜日期", "总收入", "总支出", "总利润"]);
  sheet.addRow(["C1", "2026-09-08", 100, 50, 50]);
  sheet.addRow(["C2", "2026-09-08", { formula: "1-1", result: 0 }, { formula: "2-2", result: 0 }, { formula: "3-3", result: 0 }]);
  sheet.addRow(["合计", 2, 100, 50, 50]);
  const missing = book.addWorksheet("无收入记录");
  missing.addRow(["柜号", "提柜日期", "总支出"]);
  missing.addRow(["C3", "2026-09-09", 10]);
  missing.addRow(["合计", null, 10]);
  return book;
}

function transportBook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("B运输成本");
  sheet.addRow(["客户名称", "货物来源柜号", "地址", "送仓日期", "板数", "分摊成本"]);
  sheet.addRow(["客户", "C1", "地址", "2026-09-08", 1, { formula: "20+30", result: 50 }]);
  sheet.addRow(["客户", "C2", "地址", "2026-09-08", 1, { formula: "1-1", result: 0 }]);
  sheet.addRow(["客户", "C3", "地址", "2026-09-09", 1, "LTL"]);
  return book;
}

function rows() {
  return calculateSavAccounting({ containers: [
    { id: "1", containerNumber: "C1", customerName: null, pickupDate: null, sourceIncomeComplete: true, sourceExpenseComplete: true },
    { id: "2", containerNumber: "C2", customerName: null, pickupDate: null, sourceIncomeComplete: true, sourceExpenseComplete: true }
  ], goods: [], trips: [], incomeLines: [] }).rows;
}

test("Excel parsing preserves cached formula zero, excludes total rows, and leaves absent income null", async () => {
  const baseline = await parseSavBaseline([await file(profitBook())]);
  assert.equal(baseline.containers.length, 3);
  assert.deepEqual(baseline.containers[1], { containerNumber: "C2", income: 0, expense: 0, profit: 0 });
  assert.deepEqual(baseline.containers[2], { containerNumber: "C3", income: null, expense: 10, profit: null });
});

test("both file orders merge transport controls and summary, while later transport-only upload preserves summary", async () => {
  const profit = await file(profitBook(), "利润.xlsx"); const transport = await file(transportBook(), "成本.xlsx");
  const forward = await parseSavBaseline([profit, transport]);
  const backward = await parseSavBaseline([transport, profit]);
  assert.deepEqual(forward.containers, backward.containers);
  assert.deepEqual(forward.transport, { sourceName: "成本.xlsx", goodsCount: 3, knownExpense: 50 });
  assert.deepEqual(forward.transport, backward.transport);
  const merged = await parseSavBaseline([transport], forward);
  assert.deepEqual(merged.containers, forward.containers);
  assert.equal(forward.sourceName, "利润.xlsx");
});

test("duplicate summary/missing-income keys and unsupported workbook shapes are rejected", async () => {
  const duplicate = profitBook(); duplicate.getWorksheet("无收入记录")!.addRow(["C1", null, 10]);
  await assert.rejects(() => parseSavBaseline([{ name: "损坏.xlsx", bytes: new Uint8Array() }]), /无法读取/);
  await assert.rejects(() => file(duplicate).then(value => parseSavBaseline([value])), /重复柜号/);
  const invalid = new ExcelJS.Workbook(); invalid.addWorksheet("Sheet1");
  await assert.rejects(() => file(invalid).then(value => parseSavBaseline([value])), /未找到/);
  await assert.rejects(() => parseSavBaseline([]), /最多两个/);
});

test("reconciliation keeps a known cost difference visible when income is pending and preserves missing matches", () => {
  const actual = rows(); actual[0].income = null; actual[0].expense = 60;
  const baseline: SavBaseline = { importedAt: "", sourceName: "", containers: [
    { containerNumber: "C1", income: 100, expense: 50, profit: 50 },
    { containerNumber: "C2", income: 0, expense: 0, profit: 0 },
    { containerNumber: "C3", income: 0, expense: 0, profit: 0 }
  ] };
  const result = reconcileSav(actual, baseline);
  assert.equal(result.rows.find(row => row.containerNumber === "C1")?.status, "different");
  assert.equal(result.rows.find(row => row.containerNumber === "C1")?.incomeDifference, null);
  assert.equal(result.rows.find(row => row.containerNumber === "C1")?.expenseDifference, 10);
  assert.equal(result.rows.find(row => row.containerNumber === "C2")?.status, "matched");
  assert.equal(result.rows.find(row => row.containerNumber === "C3")?.status, "baseline_only");
  assert.deepEqual(result.summary, { matched: 1, different: 1, pending: 0, sourceOnly: 0, baselineOnly: 1 });
});

test("same visible container aggregates source orders and any missing component remains pending", () => {
  const actual = rows(); actual[1].containerNumber = "C1"; actual[0].income = 20; actual[1].income = 30;
  actual[0].expense = 10; actual[1].expense = 15;
  const baseline: SavBaseline = { importedAt: "", sourceName: "", containers: [{ containerNumber: "C1", income: 50, expense: 25, profit: 25 }] };
  assert.equal(reconcileSav(actual, baseline).rows[0].status, "matched");
  actual[1].expense = null;
  assert.equal(reconcileSav(actual, baseline).rows[0].status, "pending");
  assert.equal(reconcileSav(actual, baseline).rows[0].actualExpense, null);
});

test("calibration evidence stores complete original goods membership and only LTL source amounts", async () => {
  const book = profitBook(); const goods = book.addWorksheet("B计价明细"); const trips = book.addWorksheet("行程计价");
  for (const [rowIndex, id, trip, method, amount] of [[5, "10", "T1", "私仓", 100], [6, "11", "T1", "私仓", 100], [7, "12", "T2", "LTL", 0], [8, "13", "T3", "自提", 10]] as const) {
    goods.getCell(`A${rowIndex}`).value = id; goods.getCell(`K${rowIndex}`).value = trip;
    goods.getCell(`J${rowIndex}`).value = method; goods.getCell(`O${rowIndex}`).value = { formula: String(amount), result: amount };
  }
  for (const [rowIndex, id, miles] of [[17, "T1", 10.9], [18, "T2", null], [19, "T3", 0]] as const) {
    trips.getCell(`A${rowIndex}`).value = id; trips.getCell(`D${rowIndex}`).value = miles; trips.getCell(`E${rowIndex}`).value = 1;
  }
  const baseline = await parseSavBaseline([await file(book)]);
  assert.equal(baseline.tripEvidence?.length, 2);
  assert.deepEqual(baseline.tripEvidence?.[0].goodsIds, ["10", "11"]);
  assert.equal(baseline.tripEvidence?.[0].miles, 10.9);
  assert.equal(baseline.tripEvidence?.[0].explicitAmount, undefined);
  assert.equal(baseline.tripEvidence?.[1].explicitAmount, 0);
  assert.match(baseline.tripEvidence![0].sourceReference, /行程计价!A17/);
});
