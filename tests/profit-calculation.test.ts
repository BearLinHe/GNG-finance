import assert from "node:assert/strict";
import test from "node:test";
import { calculateContainerExpenses, getMonthlyExpenseAllocationScope } from "../lib/profit-calculation";
import type { ExpenseStandard } from "../lib/system-db";

type ProfitFacts = Parameters<typeof calculateContainerExpenses>[0];

const periodKey = "pickup:2026-08-26:2026-09-25";

function standard(overrides: Partial<ExpenseStandard> = {}): ExpenseStandard {
  return {
    id: 1,
    category: "transport",
    standard_kind: "monthly",
    standard_name: "Chassis rent",
    amount: 100,
    unit: "month",
    billing_month: "2026-08-01",
    period_start: "2026-08-26",
    period_end: "2026-09-25",
    vendor_name: null,
    application_rule: "monthly_prorated",
    operation_mode: "direct_delivery",
    description: null,
    is_active: true,
    created_at: "2026-10-15",
    updated_at: "2026-10-15",
    ...overrides
  };
}

function facts(overrides: Partial<ProfitFacts> = {}): ProfitFacts {
  return {
    sourceOrderId: 1,
    operationMode: "unload",
    directRejectionUnload: false,
    pickupDate: "2026-09-01",
    unloadDate: "2026-10-01",
    pickupOut: false,
    returnEmpty: false,
    warehouseAllocations: [],
    methodAllocations: [],
    rejectionTrips: [],
    deliveryTrips: [],
    monthlyAllocationContainerCount: 1,
    monthlyAllocationPosition: 1,
    unloadMonthlyAllocationContainerCount: 1,
    unloadMonthlyAllocationPosition: 1,
    directMonthlyAllocationContainerCount: 1,
    directMonthlyAllocationPosition: 1,
    pickupMonthlyAllocationContainerCount: 3,
    pickupMonthlyAllocationPosition: 1,
    periodAllocations: { [periodKey]: { containerCount: 3, position: 1 } },
    ...overrides
  };
}

test("existing transport expenses share one pickup pool across both operation modes", () => {
  assert.equal(getMonthlyExpenseAllocationScope(standard()), "pickup");
  assert.equal(getMonthlyExpenseAllocationScope(standard({ operation_mode: null })), "pickup");

  const containers = [
    facts({ sourceOrderId: 1, operationMode: "unload" }),
    facts({ sourceOrderId: 2, operationMode: "direct_delivery" }),
    facts({ sourceOrderId: 3, operationMode: "direct_delivery", directRejectionUnload: true })
  ];
  const results = containers.map((container, index) => calculateContainerExpenses({
    ...container,
    periodAllocations: { [periodKey]: { containerCount: 3, position: index + 1 } }
  }, [], [], [standard()]));

  assert.deepEqual(results.map((result) => result.totalExpense), [33.34, 33.33, 33.33]);
  assert.equal(results.reduce((sum, result) => sum + Math.round(result.totalExpense * 100), 0), 10000);
  assert.ok(results.every((result) => result.expenseLines.length === 1));
});

test("transport allocation includes both endpoints and uses pickup rather than unload date", () => {
  for (const pickupDate of ["2026-08-26", "2026-09-25", "2026-09-25 23:59:59+00"]) {
    const result = calculateContainerExpenses(facts({ pickupDate }), [], [], [standard()]);
    assert.equal(result.totalExpense, 33.34);
  }
  for (const pickupDate of ["2026-08-25", "2026-09-26", null]) {
    const result = calculateContainerExpenses(facts({ pickupDate, unloadDate: "2026-09-01" }), [], [], [standard()]);
    assert.equal(result.totalExpense, 0);
  }
});

test("operations outside unload and direct delivery do not share transport expenses", () => {
  const result = calculateContainerExpenses(facts({ operationMode: "loose_cargo" }), [], [], [standard()]);
  assert.equal(result.totalExpense, 0);
});

test("natural-month transport expenses also use the combined pickup count", () => {
  const monthly = standard({ period_start: null, period_end: null, billing_month: "2026-09-01" });
  for (const operationMode of ["unload", "direct_delivery"]) {
    assert.equal(calculateContainerExpenses(facts({ operationMode }), [], [], [monthly]).totalExpense, 33.34);
  }
});

test("warehouse expenses still follow unload dates and include rejection conversions", () => {
  const warehouse = standard({ category: "warehouse", operation_mode: "unload", amount: 200 });
  const warehouseFacts = facts({
    pickupDate: "2026-10-01",
    unloadDate: "2026-09-01",
    periodAllocations: { "unload:2026-08-26:2026-09-25": { containerCount: 2, position: 1 } }
  });
  assert.equal(calculateContainerExpenses(warehouseFacts, [], [], [warehouse]).totalExpense, 100);
  assert.equal(calculateContainerExpenses({ ...warehouseFacts, operationMode: "direct_delivery" }, [], [], [warehouse]).totalExpense, 0);
  assert.equal(calculateContainerExpenses({
    ...warehouseFacts,
    operationMode: "direct_delivery",
    directRejectionUnload: true
  }, [], [], [warehouse]).totalExpense, 100);
});

test("recurring warehouse rent keeps its unload-month allocation", () => {
  const rent = standard({
    category: "warehouse",
    operation_mode: "unload",
    amount: 135000,
    period_start: null,
    period_end: null,
    billing_month: null
  });
  const result = calculateContainerExpenses(facts({ unloadMonthlyAllocationContainerCount: 2 }), [], [], [rent]);
  assert.equal(result.totalExpense, 67500);
});

test("separate expense periods use independent counts and exclude non-overlapping costs", () => {
  const nextPeriod = standard({ id: 2, period_start: "2026-09-01", period_end: "2026-09-30", amount: 200 });
  const outsidePeriod = standard({ id: 3, period_start: "2026-10-01", period_end: "2026-10-31", amount: 1000 });
  const result = calculateContainerExpenses(facts({
    periodAllocations: {
      [periodKey]: { containerCount: 3, position: 1 },
      "pickup:2026-09-01:2026-09-30": { containerCount: 4, position: 1 }
    }
  }), [], [], [standard(), nextPeriod, outsidePeriod]);
  assert.deepEqual(result.expenseLines.map((line) => line.amount), [33.34, 50]);
  assert.equal(result.totalExpense, 83.34);
});
