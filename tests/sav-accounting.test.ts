import assert from "node:assert/strict";
import test from "node:test";
import { calculateSavAccounting, savRound } from "../lib/sav-accounting";
import type { SavAccountingInput, SavContainerInput, SavGoodsInput } from "../lib/sav-accounting-types";

function container(id = "c1", overrides: Partial<SavContainerInput> = {}): SavContainerInput {
  return { id, containerNumber: id.toUpperCase(), customerName: "SAV 客户", pickupDate: "2026-09-08", ...overrides };
}

function goods(id = "1", containerId = "c1", overrides: Partial<SavGoodsInput> = {}): SavGoodsInput {
  return { id, containerId, tripId: "t1", method: "私仓", loadedPallets: 1,
    rejectedPallets: 0, status: "transport", ...overrides };
}

function input(overrides: Partial<SavAccountingInput> = {}): SavAccountingInput {
  return { containers: [container()], goods: [goods()],
    trips: [{ id: "t1", miles: 10.9, stopCount: 1 }],
    incomeLines: [{ id: "i1", containerId: "c1", category: "delivery", amount: 300, label: "派送费" }],
    ...overrides };
}

test("all-order billing preserves zero-data orders and does not present partial transport costs as final profit", () => {
  const source = input({ containers: [container("c1", { accountingScope: "all", operationMode: "direct_delivery", pickupDate: null }), container("empty", { accountingScope: "all", pickupDate: null })] });
  source.incomeLines.push({ id: "i2", containerId: "c1", category: "other", amount: 500, label: "提拆账单" });
  const result = calculateSavAccounting(source);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].income, 800);
  assert.equal(result.rows[0].otherIncome, 500);
  assert.equal(result.rows[0].expense, 200);
  assert.equal(result.rows[0].transportBalance, 600);
  assert.equal(result.rows[0].profit, null);
  assert.equal(result.rows[0].provisional, true);
  assert.equal(result.rows[1].income, null);
  assert.equal(result.rows[1].expense, null);
  assert.equal(result.rows[1].transportBalance, null);
  assert.equal(result.summary.transportBalance, 600);
  assert.equal(result.summary.calculatedBalanceCount, 1);
  assert.equal(result.summary.completeCount, 0);
});

test("single stop uses minimum base, multiple stops add fees, miles round to nearest $50", () => {
  assert.equal(calculateSavAccounting(input()).rows[0].expense, 200);
  const result = calculateSavAccounting(input({ trips: [{ id: "t1", miles: 129.6, stopCount: 3 }] }));
  assert.equal(result.rows[0].expense, 950);
  assert.equal(result.rows[0].profit, -650);
  assert.equal(savRound(-1.125), -1.13);
  assert.equal(calculateSavAccounting(input({ trips: [{ id: "t1", miles: 250 / 4.3 + 25 / 4.3, stopCount: 1 }] })).rows[0].expense, 300);
});

test("full trip denominator includes goods outside selected containers and original rejected pallets", () => {
  const result = calculateSavAccounting(input({
    goods: [goods("1", "c1", { loadedPallets: 6, rejectedPallets: 6 }), goods("2", "other", { loadedPallets: 19 })],
    trips: [{ id: "t1", miles: 400, stopCount: 2 }]
  }));
  assert.equal(result.trips[0].amount, 1900);
  assert.equal(result.trips[0].loadedPallets, 25);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].expense, 456);
  assert.equal(result.rows[0].goods[0].netPallets, 0);
});

test("round cents per source row with residual on last positive row and numeric-aware stable ordering", () => {
  const data = input({ containers: [container("c1"), container("c2"), container("c3")],
    goods: [goods("10", "c3"), goods("2", "c2"), goods("1", "c1")],
    trips: [{ id: "t1", miles: null, stopCount: null, explicitAmount: 100 }] });
  const result = calculateSavAccounting(data);
  assert.deepEqual(result.rows.map(row => row.expense), [33.33, 33.33, 33.34]);
  assert.equal(result.summary.expense, 100);
  assert.deepEqual(calculateSavAccounting({ ...data, goods: [...data.goods].reverse() }).rows.map(row => row.expense), [33.33, 33.33, 33.34]);
  const sourceOrder = calculateSavAccounting({ ...data, goods: data.goods.map((item, index) => ({ ...item, allocationOrder: index })) });
  assert.deepEqual(sourceOrder.rows.map(row => row.expense), [33.34, 33.33, 33.33]);
});

test("zero-pallet row has zero allocation but an entirely zero-pallet trip is unavailable", () => {
  const data = input({ goods: [goods("1", "c1", { loadedPallets: 0 }), goods("2", "c1", { loadedPallets: 1 })] });
  assert.deepEqual(calculateSavAccounting(data).rows[0].goods.map(item => item.amount), [0, 200]);
  const result = calculateSavAccounting(input({ goods: [goods("1", "c1", { loadedPallets: 0 })] }));
  assert.equal(result.rows[0].expense, null);
  assert.equal(result.rows[0].profit, null);
  assert.equal(result.summary.pendingCostCount, 1);
});

test("pickup is $10 per original pallet and unpriced LTL blocks complete totals", () => {
  const result = calculateSavAccounting(input({ goods: [
    goods("1", "c1", { method: "自提", loadedPallets: 7, rejectedPallets: 2, tripId: null }),
    goods("2", "c1", { method: "LTL", tripId: "ltl" })
  ], trips: [{ id: "ltl", miles: 100, stopCount: 1 }] }));
  assert.equal(result.rows[0].goods[0].amount, 70);
  assert.equal(result.rows[0].knownExpense, 70);
  assert.equal(result.rows[0].expense, null);
  assert.equal(result.summary.expense, null);
  assert.equal(result.rows[0].profit, null);
  const ltl = calculateSavAccounting(input({ goods: [goods("1", "c1", { method: "LTL" })],
    trips: [{ id: "t1", miles: null, stopCount: null, explicitAmount: 312.61 }] }));
  assert.equal(ltl.rows[0].expense, 312.61);
});

test("missing income differs from confirmed zero and unknown categories prevent a healthy profit", () => {
  const missing = calculateSavAccounting(input({ incomeLines: [] }));
  assert.equal(missing.rows[0].income, null);
  assert.equal(missing.rows[0].profit, null);
  assert.equal(missing.rows[0].incomeStatus, "missing");
  const zero = calculateSavAccounting(input({ containers: [container("c1", { sourceIncomeComplete: true })], incomeLines: [] }));
  assert.equal(zero.rows[0].income, 0);
  assert.equal(zero.rows[0].profit, -200);
  const unknown = calculateSavAccounting(input({ incomeLines: [
    ...input().incomeLines,
    { id: "u", containerId: "c1", category: "unclassified", amount: 0, label: "待核对费用" },
    { id: "excluded", containerId: "c1", category: "excluded", amount: 10000, label: "拆柜费" }
  ] }));
  assert.equal(unknown.rows[0].knownIncome, 300);
  assert.equal(unknown.rows[0].income, null);
  assert.equal(unknown.rows[0].profit, null);
});

test("income sums delivery and labor, keeps credits and excludes unrelated bill lines", () => {
  const result = calculateSavAccounting(input({ incomeLines: [
    { id: "1", containerId: "c1", category: "delivery", amount: 300, label: "派送费" },
    { id: "2", containerId: "c1", category: "labor", amount: 60, label: "出库人工" },
    { id: "3", containerId: "c1", category: "delivery", amount: -10, label: "派送折让" },
    { id: "4", containerId: "c1", category: "excluded", amount: 500, label: "拆柜费" }
  ] }));
  assert.equal(result.rows[0].income, 350);
  assert.equal(result.rows[0].profit, 150);
});

test("stock and returns are distinct, do not dilute trip costs, and flag stage-only profit", () => {
  const result = calculateSavAccounting(input({ goods: [
    goods(),
    goods("2", "c1", { status: "in_stock", loadedPallets: 10 }),
    goods("3", "c1", { status: "returned", loadedPallets: 2 })
  ] }));
  assert.equal(result.rows[0].expense, 200);
  assert.equal(result.rows[0].inStockPallets, 10);
  assert.equal(result.rows[0].returnedPallets, 2);
  assert.equal(result.rows[0].provisional, true);
  assert.equal(result.rows[0].statusLabel, "阶段核算");
  const stockOnly = calculateSavAccounting(input({ goods: [goods("2", "c1", { status: "in_stock", loadedPallets: 10 })] }));
  assert.equal(stockOnly.rows[0].expense, null);
  assert.equal(stockOnly.rows[0].profit, null);
});

test("bad facts, pending trip participants, absent trips and invalid pricing cannot become zero-cost success", () => {
  for (const data of [
    input({ goods: [goods("1", "c1", { loadedPallets: null })] }),
    input({ goods: [goods("1", "c1", { rejectedPallets: 2 })] }),
    input({ goods: [goods(), goods("2", "other", { status: "pending" })] }),
    input({ trips: [] }),
    input({ trips: [{ id: "t1", miles: null, stopCount: 1 }] }),
    input({ trips: [{ id: "t1", miles: 10, stopCount: 0 }] })
  ]) {
    const result = calculateSavAccounting(data);
    assert.equal(result.rows[0].expense, null);
    assert.equal(result.rows[0].profit, null);
    assert.ok(result.rows[0].warnings.length);
  }
  assert.throws(() => calculateSavAccounting(input({ pricing: { roundingUnit: 0 } })), /计价参数/);
  assert.throws(() => calculateSavAccounting(input({ goods: [goods(), goods()] })), /重复 ID/);
});

test("summary distinguishes accrued known amounts, comparable profit and incomplete portfolio", () => {
  const result = calculateSavAccounting(input({ containers: [container("c1"), container("c2")],
    goods: [goods(), goods("2", "c2", { method: "LTL", tripId: "ltl" })],
    trips: [...input().trips, { id: "ltl", miles: null, stopCount: null }] }));
  assert.equal(result.summary.containerCount, 2);
  assert.equal(result.summary.knownIncome, 300);
  assert.equal(result.summary.knownExpense, 200);
  assert.equal(result.summary.comparableProfit, 100);
  assert.equal(result.summary.profit, null);
  assert.equal(result.summary.completeCount, 1);
  assert.equal(result.summary.pendingContainerCount, 1);
});
