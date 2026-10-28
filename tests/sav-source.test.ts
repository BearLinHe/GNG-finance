import assert from "node:assert/strict";
import test from "node:test";
import { classifySavIncome, getSavSourceAccounting, savInvoiceIncomeLines, SavSourceInputError, type SavInvoiceSourceRow } from "../lib/sav-source-db";

test("SAV income matches the Excel delivery and outbound-fee scope", () => {
  assert.equal(classifySavIncome("Delivery", "派送费"), "delivery");
  assert.equal(classifySavIncome("Pallets Out", "出库费"), "labor");
  assert.equal(classifySavIncome(" delivery ", null), "delivery");
  assert.equal(classifySavIncome(null, "出库费"), "labor");
  // These fees exist on the same CoreFlow invoices but were not included in
  // any of the 154 reference Excel container-income totals.
  assert.equal(classifySavIncome("Split", "分货费"), "excluded");
  assert.equal(classifySavIncome("Labeling", "贴标费"), "excluded");
  assert.equal(classifySavIncome("Others", "其他费用"), "excluded");
  assert.equal(classifySavIncome("Terminal Pick Up", "pick up1"), "excluded");
  assert.equal(classifySavIncome("亚马逊组合柜-B区", "RDU2"), "excluded");
  assert.equal(classifySavIncome("STORAGE", "仓储费"), "excluded");
});

test("unknown source income categories remain visible for review", () => {
  assert.equal(classifySavIncome("new unrecognized fee", "新项目"), "unclassified");
  assert.equal(classifySavIncome("待补价", "仓点未记录"), "unclassified");
  assert.equal(classifySavIncome(null, null), "unclassified");
});

test("invalid source filters are rejected before opening a database connection", async () => {
  await assert.rejects(getSavSourceAccounting({ dateFrom: "2026-02-30" }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ dateTo: "2026-2-3" }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ dateFrom: "2026-10-25", dateTo: "2026-09-07" }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ search: "x".repeat(151) }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ page: 0 }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ page: 1.5 }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ pageSize: 301 }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ scope: "invalid" as never }), SavSourceInputError);
  await assert.rejects(getSavSourceAccounting({ operationMode: "x".repeat(51) }), SavSourceInputError);
});

function invoice(overrides: Partial<SavInvoiceSourceRow> = {}): SavInvoiceSourceRow {
  return { id: "1", invoice_id: "10", container_id: "100", invoice_number: "CS-10", invoice_status: "issued",
    invoice_type: "unload", currency: "USD", header_amount: "130", manual_total_amount: true,
    fee_code: "Delivery", fee_name: "派送费", line_amount: "100", line_notes: null, line_status: "draft", ...overrides };
}

test("all-order income includes other valid bill charges and reconciles manual invoice totals without duplication", () => {
  assert.equal(classifySavIncome("STORAGE", "仓储费", "all"), "other");
  assert.equal(classifySavIncome("new fee", "未知收费", "all"), "other");
  assert.equal(classifySavIncome("待补价", "INC1", "all"), "unclassified");
  const rows = [invoice(), invoice({ id: "2", fee_code: "STORAGE", fee_name: "仓储费", line_amount: "50" })];
  const all = savInvoiceIncomeLines(rows, "all");
  assert.equal(all.length, 3);
  assert.equal(all.find(line => line.id === "2")?.category, "other");
  assert.equal(all.find(line => line.id === "invoice:10:adjustment")?.amount, -20);
  assert.equal(all.reduce((sum, line) => sum + (line.amount || 0), 0), 130);
  assert.match(all[2].sourceReference || "", /CS-10/);
  const excel = savInvoiceIncomeLines(rows, "excel");
  assert.equal(excel.length, 2);
  assert.equal(excel[1].category, "excluded");
});

test("header-only zero invoices differ from missing invoices; foreign currency stays unresolved", () => {
  assert.deepEqual(savInvoiceIncomeLines([], "all"), []);
  const zero = savInvoiceIncomeLines([invoice({ id: null, header_amount: "0", line_amount: null })], "all");
  assert.equal(zero[0].amount, 0);
  assert.equal(zero[0].category, "other");
  assert.deepEqual(savInvoiceIncomeLines([invoice({ id: null, header_amount: "0", line_amount: null })], "excel"), []);
  const foreign = savInvoiceIncomeLines([invoice({ currency: "CNY", header_amount: "100" })], "all");
  assert.equal(foreign[0].amount, null);
  assert.equal(foreign[0].category, "unclassified");
});
