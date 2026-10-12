import { NextResponse } from "next/server";
import { calculateContainerExpenses } from "@/lib/profit-calculation";
import {
  getSourceContainerExpenseFacts,
  getSourceOperationMonthAllocations,
  searchSourceContainerProfitRows
} from "@/lib/source-db";
import {
  listExpenseStandards,
  listTransportPricingRules,
  listWarehousePickupPricingRules
} from "@/lib/system-db";

export const dynamic = "force-dynamic";

type ProfitResponse = {
  rows: Array<Record<string, unknown>>;
  totalCount: number;
  page: number;
  pageSize: number;
  pageSummary: {
    income: number;
    expense: number;
    profit: number;
    profitableCount: number;
    lossCount: number;
    breakEvenCount: number;
  };
};

const profitGlobal = globalThis as typeof globalThis & {
  gngContainerProfitCache?: Map<string, { expiresAt: number; payload: ProfitResponse }>;
};
const responseCache: Map<string, { expiresAt: number; payload: ProfitResponse }> =
  profitGlobal.gngContainerProfitCache ?? (profitGlobal.gngContainerProfitCache = new Map());
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 100), 10), 300);
    const search = url.searchParams.get("search") || "";
    const customerName = url.searchParams.get("customerName") || "";
    const dateField = url.searchParams.get("dateField") || "";
    const dateFrom = url.searchParams.get("dateFrom") || "";
    const dateTo = url.searchParams.get("dateTo") || "";
    const requestedMode = url.searchParams.get("operationMode") || "";
    const operationMode = ["unload", "direct_delivery"].includes(requestedMode) ? requestedMode : undefined;
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const cacheKey = JSON.stringify({ page, pageSize, search, customerName, dateField, dateFrom, dateTo, operationMode });
    const cached = responseCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { "X-Finance-Cache": "HIT" }
      });
    }

    const [sourceRows, transportRules, warehousePickupRules, expenseStandards] = await Promise.all([
      searchSourceContainerProfitRows({
        search,
        customerName,
        dateField,
        dateFrom,
        dateTo,
        operationMode,
        page,
        pageSize
      }),
      listTransportPricingRules(),
      listWarehousePickupPricingRules(),
      listExpenseStandards()
    ]);
    const expenseFacts = await getSourceContainerExpenseFacts(
      sourceRows.map((row) => row.sourceOrderId),
      forceRefresh
    );
    const unloadMonths = sourceRows
      .filter((row) => row.operationMode === "unload" || expenseFacts.get(row.sourceOrderId)?.directRejectionUnload)
      .map((row) => row.unloadDate?.slice(0, 7) || "")
      .filter(Boolean);
    const directMonths = sourceRows
      .filter((row) => row.operationMode === "direct_delivery")
      .map((row) => row.pickupDate?.slice(0, 7) || "")
      .filter(Boolean);
    const [unloadMonthAllocations, directMonthAllocations] = await Promise.all([
      getSourceOperationMonthAllocations("unload", unloadMonths, forceRefresh),
      getSourceOperationMonthAllocations("direct_delivery", directMonths, forceRefresh)
    ]);

    const rows = sourceRows.map((row) => {
      const facts = expenseFacts.get(row.sourceOrderId) || {
        sourceOrderId: row.sourceOrderId,
        directRejectionUnload: false,
        pickupOut: false,
        returnEmpty: false,
        warehouseAllocations: [],
        methodAllocations: [],
        rejectionTrips: [],
        deliveryTrips: []
      };
      const monthlyAllocation = row.operationMode === "direct_delivery"
        ? directMonthAllocations.get(row.sourceOrderId)
        : unloadMonthAllocations.get(row.sourceOrderId);
      const unloadMonthlyAllocation = unloadMonthAllocations.get(row.sourceOrderId);
      const directMonthlyAllocation = directMonthAllocations.get(row.sourceOrderId);
      const expense = calculateContainerExpenses({
        ...facts,
        operationMode: row.operationMode,
        pickupDate: row.pickupDate,
        unloadDate: row.unloadDate,
        monthlyAllocationContainerCount: monthlyAllocation?.containerCount || 0,
        monthlyAllocationPosition: monthlyAllocation?.position || 0,
        unloadMonthlyAllocationContainerCount: unloadMonthlyAllocation?.containerCount || 0,
        unloadMonthlyAllocationPosition: unloadMonthlyAllocation?.position || 0,
        directMonthlyAllocationContainerCount: directMonthlyAllocation?.containerCount || 0,
        directMonthlyAllocationPosition: directMonthlyAllocation?.position || 0
      }, transportRules, warehousePickupRules, expenseStandards);
      const incomeAmount = Number(row.sourceInvoiceTotalAmount || 0);

      return {
        ...row,
        directRejectionUnload: facts.directRejectionUnload,
        incomeAmount: Number(incomeAmount.toFixed(2)),
        expenses: expense.expenses,
        expenseLines: expense.expenseLines,
        expenseAmount: expense.totalExpense,
        netProfit: Number((incomeAmount - expense.totalExpense).toFixed(2)),
        unmatchedExpenseCount: expense.expenseLines.filter((line) => !line.matched).length
      };
    });

    const payload = {
      rows,
      totalCount: sourceRows[0]?.totalCount || 0,
      page,
      pageSize,
      pageSummary: {
        income: Number(rows.reduce((sum, row) => sum + row.incomeAmount, 0).toFixed(2)),
        expense: Number(rows.reduce((sum, row) => sum + row.expenseAmount, 0).toFixed(2)),
        profit: Number(rows.reduce((sum, row) => sum + row.netProfit, 0).toFixed(2)),
        profitableCount: rows.filter((row) => row.netProfit > 0).length,
        lossCount: rows.filter((row) => row.netProfit < 0).length,
        breakEvenCount: rows.filter((row) => row.netProfit === 0).length
      }
    } satisfies ProfitResponse;
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    if (responseCache.size > 40) responseCache.delete(responseCache.keys().next().value as string);

    return NextResponse.json(payload, {
      headers: { "X-Finance-Cache": "MISS" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取单柜盈亏失败" },
      { status: 500 }
    );
  }
}
