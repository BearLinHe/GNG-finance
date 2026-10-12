import { NextResponse } from "next/server";
import {
  getSourceContainerExpenseFacts,
  getSourceContainerProfile,
  getSourceInitialBillExact,
  getSourceOperationMonthAllocations
} from "@/lib/source-db";
import {
  getBillsBySourceOrderIds,
  listContainerAmountItems,
  listExpenseStandards,
  listTransportPricingRules,
  listWarehousePickupPricingRules
} from "@/lib/system-db";
import { calculateContainerExpenses } from "@/lib/profit-calculation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("containerNumber") || "";
    const profile = await getSourceContainerProfile(query);

    if (!profile) {
      return NextResponse.json({ profile: null, items: [] });
    }

    const [items, sourceInitialBill, localBills, transportRules, warehousePickupRules, expenseFactsByOrder, expenseStandards] = await Promise.all([
      listContainerAmountItems(profile.sourceOrderId),
      getSourceInitialBillExact(profile.sourceOrderId),
      getBillsBySourceOrderIds([profile.sourceOrderId]),
      listTransportPricingRules(),
      listWarehousePickupPricingRules(),
      getSourceContainerExpenseFacts([profile.sourceOrderId]),
      listExpenseStandards()
    ]);
    const localBill = localBills.get(profile.sourceOrderId) || null;
    const incomeAmount = Number(
      sourceInitialBill?.sourceInvoiceTotalAmount
      ?? profile.invoiceTotalAmount
      ?? localBill?.preset_receivable_amount
      ?? 0
    );

    const expenseFacts = expenseFactsByOrder.get(profile.sourceOrderId) || {
      sourceOrderId: profile.sourceOrderId,
      directRejectionUnload: false,
      pickupOut: profile.pickupOut,
      returnEmpty: profile.returnEmpty,
      warehouseAllocations: [],
      methodAllocations: [],
      rejectionTrips: [],
      deliveryTrips: profile.deliveryTrips
    };
    const [unloadMonthAllocations, directMonthAllocations] = await Promise.all([
      getSourceOperationMonthAllocations(
        "unload",
        profile.plannedUnloadAt ? [profile.plannedUnloadAt.slice(0, 7)] : []
      ),
      getSourceOperationMonthAllocations(
        "direct_delivery",
        profile.pickupDate ? [profile.pickupDate.slice(0, 7)] : []
      )
    ]);
    const unloadMonthlyAllocation = unloadMonthAllocations.get(profile.sourceOrderId);
    const directMonthlyAllocation = directMonthAllocations.get(profile.sourceOrderId);
    const monthlyAllocation = profile.operationMode === "direct_delivery"
      ? directMonthlyAllocation
      : unloadMonthlyAllocation;
    const { expenses, expenseLines, totalExpense } = calculateContainerExpenses({
      ...expenseFacts,
      operationMode: profile.operationMode,
      pickupDate: profile.pickupDate,
      unloadDate: profile.plannedUnloadAt,
      monthlyAllocationContainerCount: monthlyAllocation?.containerCount || 0,
      monthlyAllocationPosition: monthlyAllocation?.position || 0,
      unloadMonthlyAllocationContainerCount: unloadMonthlyAllocation?.containerCount || 0,
      unloadMonthlyAllocationPosition: unloadMonthlyAllocation?.position || 0,
      directMonthlyAllocationContainerCount: directMonthlyAllocation?.containerCount || 0,
      directMonthlyAllocationPosition: directMonthlyAllocation?.position || 0
    }, transportRules, warehousePickupRules, expenseStandards);

    return NextResponse.json({
      profile,
      items,
      profitSummary: {
        income: {
          label: "源系统有效账单汇总",
          amount: Number(incomeAmount.toFixed(2)),
          source: sourceInitialBill ? "initial_bill" : localBill ? "system_bill" : "not_found",
          billId: localBill?.id || null
        },
        expenses,
        expenseLines,
        totalExpense: Number(totalExpense.toFixed(2)),
        netProfit: Number((incomeAmount - totalExpense).toFixed(2))
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取柜号信息失败" },
      { status: 500 }
    );
  }
}
