import type { SourceContainerExpenseFacts } from "@/lib/source-db";
import type {
  ExpenseStandard,
  TransportPricingRule,
  WarehousePickupPricingRule
} from "@/lib/system-db";

export type ExpenseCategoryKey = "transport" | "warehouse" | "domestic";

export type MatchedExpenseLine = {
  key: string;
  category: ExpenseCategoryKey;
  standardName: string;
  condition: string;
  warehousePoint: string | null;
  quantity: number;
  unitAmount: number;
  amount: number;
  matched: boolean;
};

type ProfitFacts = SourceContainerExpenseFacts & {
  operationMode: string | null;
  pickupDate: string | null;
  unloadDate: string | null;
  monthlyAllocationContainerCount: number;
  monthlyAllocationPosition: number;
  unloadMonthlyAllocationContainerCount?: number;
  unloadMonthlyAllocationPosition?: number;
  directMonthlyAllocationContainerCount?: number;
  directMonthlyAllocationPosition?: number;
  periodAllocations?: Record<string, { containerCount: number; position: number }>;
};

const expenseCategories: Array<{ key: ExpenseCategoryKey; label: string }> = [
  { key: "transport", label: "运输支出" },
  { key: "warehouse", label: "仓库支出" },
  { key: "domestic", label: "国内支出" }
];

function normalizedPoint(value: string | null | undefined) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function calculateContainerExpenses(
  facts: ProfitFacts,
  transportRules: TransportPricingRule[],
  warehousePickupRules: WarehousePickupPricingRule[] = [],
  fixedStandards: ExpenseStandard[] = []
) {
  const isUnload = facts.operationMode === "unload";
  const isDirect = facts.operationMode === "direct_delivery";
  const isDirectRejectionUnload = isDirect && facts.directRejectionUnload;
  const fixedConditions: Record<string, { matched: boolean; condition: string }> = {
    pickup_out: {
      matched: isUnload || isDirect || facts.pickupOut || Boolean(facts.pickupDate),
      condition: isUnload
        ? "拆柜固定运输：奥克兰码头提柜"
        : isDirect
        ? "直送固定运输：奥克兰码头提柜"
        : "源系统已有提柜日期或已标记提柜出场"
    },
    return_empty: {
      matched: isUnload || isDirect || facts.returnEmpty,
      condition: isUnload
        ? "拆柜固定运输：奥克兰码头还空"
        : isDirect
        ? "直送固定运输：奥克兰码头还空"
        : "源系统已标记还空"
    },
    unload_pickup_out: {
      matched: isUnload || isDirectRejectionUnload,
      condition: isDirectRejectionUnload
        ? "直送拒收改拆：奥克兰码头送 Hayward 仓库"
        : "拆柜固定运输：奥克兰码头送 Hayward 仓库"
    },
    unload_return_empty: {
      matched: isUnload || isDirectRejectionUnload,
      condition: isDirectRejectionUnload
        ? "直送拒收改拆：Hayward 仓库回奥克兰码头"
        : "拆柜固定运输：Hayward 仓库回奥克兰码头"
    }
  };

  const expenseLines: MatchedExpenseLine[] = transportRules
    .filter((rule) => rule.rule_type === "fixed_route")
    .flatMap((rule) => {
      const condition = fixedConditions[rule.condition_key];
      if (!condition?.matched) return [];
      return [{
        key: `transport-rule-${rule.id}`,
        category: "transport" as const,
        standardName: rule.rule_name,
        condition: condition.condition,
        warehousePoint: rule.warehouse_point,
        quantity: 1,
        unitAmount: rule.amount,
        amount: rule.amount,
        matched: true
      }];
    });

  for (const standard of fixedStandards) {
    if (standard.standard_kind !== "fixed" || standard.application_rule !== "per_container") continue;
    if (standard.operation_mode && standard.operation_mode !== facts.operationMode
      && !(isDirectRejectionUnload && standard.operation_mode === "unload")) continue;
    expenseLines.push({
      key: `expense-standard-${standard.id}`,
      category: standard.category,
      standardName: standard.standard_name,
      condition: standard.operation_mode === "unload"
        ? `拆柜固定支出：每柜计入 1 ${standard.unit}`
        : standard.operation_mode === "direct_delivery"
        ? `直送固定支出：每柜计入 1 ${standard.unit}`
        : `固定标准：每柜计入 1 ${standard.unit}`,
      warehousePoint: null,
      quantity: 1,
      unitAmount: standard.amount,
      amount: standard.amount,
      matched: true
    });
  }

  for (const standard of fixedStandards) {
    if (standard.standard_kind !== "monthly" || standard.application_rule !== "monthly_prorated") continue;
    if (standard.operation_mode && standard.operation_mode !== facts.operationMode
      && !(isDirectRejectionUnload && standard.operation_mode === "unload")) continue;
    const allocationDate = standard.operation_mode === "direct_delivery" ? facts.pickupDate : facts.unloadDate;
    const unloadMonth = allocationDate?.slice(0, 7) || null;
    const standardMonth = standard.billing_month?.slice(0, 7) || null;
    const hasPeriod = Boolean(standard.period_start && standard.period_end);
    if (hasPeriod && (!allocationDate
      || allocationDate < standard.period_start!
      || allocationDate > standard.period_end!)) continue;
    if (!hasPeriod && standardMonth && standardMonth !== unloadMonth) continue;
    const periodKey = hasPeriod
      ? `${standard.operation_mode || "all"}:${standard.period_start}:${standard.period_end}`
      : null;
    const periodAllocation = periodKey ? facts.periodAllocations?.[periodKey] : null;
    const containerCount = Math.max(hasPeriod
      ? periodAllocation?.containerCount || 0
      : standard.operation_mode === "direct_delivery"
      ? facts.directMonthlyAllocationContainerCount ?? facts.monthlyAllocationContainerCount
      : facts.unloadMonthlyAllocationContainerCount ?? facts.monthlyAllocationContainerCount,
    0);
    if (!allocationDate || containerCount === 0) {
      expenseLines.push({
        key: `expense-standard-${standard.id}-unmatched`,
        category: standard.category,
        standardName: `${standard.standard_name}未分摊`,
        condition: allocationDate
          ? `${hasPeriod ? `${standard.period_start} 至 ${standard.period_end}` : unloadMonth} 暂无可用于均摊的${standard.operation_mode === "direct_delivery" ? "直送" : "拆柜"}柜数`
          : `源系统缺少${standard.operation_mode === "direct_delivery" ? "提柜" : "拆柜"}日期，无法归属费用月份`,
        warehousePoint: null,
        quantity: 0,
        unitAmount: standard.amount,
        amount: 0,
        matched: false
      });
      continue;
    }
    const totalCents = Math.round(standard.amount * 100);
    const baseCents = Math.floor(totalCents / containerCount);
    const remainderCents = totalCents - baseCents * containerCount;
    const position = Math.max(hasPeriod
      ? periodAllocation?.position || 1
      : standard.operation_mode === "direct_delivery"
        ? facts.directMonthlyAllocationPosition ?? facts.monthlyAllocationPosition
        : facts.unloadMonthlyAllocationPosition ?? facts.monthlyAllocationPosition,
    1);
    const allocatedAmount = (baseCents + (position <= remainderCents ? 1 : 0)) / 100;
    const periodLabel = standard.period_start && standard.period_end
      ? `${standard.period_start.slice(5).replace("-", "/")}-${standard.period_end.slice(5).replace("-", "/")}`
      : null;
    expenseLines.push({
      key: `expense-standard-${standard.id}-${hasPeriod ? standard.period_start : unloadMonth}`,
      category: standard.category,
      standardName: periodLabel
        ? `${standard.standard_name}均摊（${periodLabel}）`
        : `${unloadMonth} ${standard.standard_name}均摊`,
      condition: `${hasPeriod ? `${standard.period_start} 至 ${standard.period_end}` : unloadMonth} ${standard.standard_name} $${standard.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ÷ ${hasPeriod ? "周期内" : "当月"} ${containerCount} 个${standard.operation_mode === "direct_delivery" ? "直送" : "拆柜"}`,
      warehousePoint: null,
      quantity: 1,
      unitAmount: allocatedAmount,
      amount: allocatedAmount,
      matched: true
    });
  }

  if (isUnload || isDirectRejectionUnload) {
    type DeliveryMethod = "卡派" | "自提";
    type MethodGroup = {
      deliveryMethod: DeliveryMethod;
      warehousePoint: string | null;
      proportion: number;
      appointmentCount: number;
    };
    const groups = new Map<string, MethodGroup>();
    const unresolved = new Map<string, { warehousePoint: string | null; proportion: number }>();

    for (const allocation of facts.warehouseAllocations || []) {
      const point = normalizedPoint(allocation.warehousePoint);
      if (!point || allocation.proportion <= 0) continue;
      const methods = (facts.methodAllocations || []).filter(
        (item) => item.orderDetailId === allocation.orderDetailId && (item.deliveryMethod === "卡派" || item.deliveryMethod === "自提")
      );
      if (!methods.length) {
        const current = unresolved.get(point);
        unresolved.set(point, {
          warehousePoint: allocation.warehousePoint,
          proportion: (current?.proportion || 0) + allocation.proportion
        });
        continue;
      }

      const totalPallets = methods.reduce((sum, item) => sum + Math.max(item.appointmentPallets, 0), 0);
      for (const method of methods) {
        const share = totalPallets > 0
          ? Math.max(method.appointmentPallets, 0) / totalPallets
          : 1 / methods.length;
        const methodPoint = normalizedPoint(method.warehousePoint) || point;
        const key = `${method.deliveryMethod}|${methodPoint}`;
        const current = groups.get(key);
        groups.set(key, {
          deliveryMethod: method.deliveryMethod as DeliveryMethod,
          warehousePoint: method.warehousePoint || allocation.warehousePoint,
          proportion: (current?.proportion || 0) + allocation.proportion * share,
          appointmentCount: Math.max(current?.appointmentCount || 0, method.appointmentCount)
        });
      }
    }

    const rejectionCounts = new Map<string, number>();
    const unknownRejections = new Map<string, number>();
    for (const rejection of facts.rejectionTrips || []) {
      const point = normalizedPoint(rejection.warehousePoint);
      if (!point) continue;
      if (rejection.deliveryMethod === "卡派" || rejection.deliveryMethod === "自提") {
        const key = `${rejection.deliveryMethod}|${point}`;
        rejectionCounts.set(key, (rejectionCounts.get(key) || 0) + rejection.rejectionCount);
      } else if (!isDirectRejectionUnload || rejection.deliveryMethod !== "直送") {
        unknownRejections.set(point, (unknownRejections.get(point) || 0) + rejection.rejectionCount);
      }
    }

    const methodsByPoint = new Map<string, Set<DeliveryMethod>>();
    for (const group of groups.values()) {
      const point = normalizedPoint(group.warehousePoint);
      if (!point) continue;
      const methods = methodsByPoint.get(point) || new Set<DeliveryMethod>();
      methods.add(group.deliveryMethod);
      methodsByPoint.set(point, methods);
    }

    for (const [key, group] of groups) {
      const point = normalizedPoint(group.warehousePoint);
      const fallbackRejections = methodsByPoint.get(point)?.size === 1 ? unknownRejections.get(point) || 0 : 0;
      const rejectionCount = (rejectionCounts.get(key) || 0) + fallbackRejections;
      const quantity = Number((group.proportion * (1 + rejectionCount)).toFixed(6));
      const isPickup = group.deliveryMethod === "自提";
      const rule = isPickup
        ? warehousePickupRules.find((item) => normalizedPoint(item.warehouse_point) === point)
        : transportRules.find(
          (item) => item.rule_type === "amazon_warehouse" && normalizedPoint(item.warehouse_point) === point
        );
      const amount = Number(((rule?.amount || 0) * quantity).toFixed(2));
      const proportionLabel = `${(group.proportion * 100).toFixed(2)}%`;
      const methodLabel = isPickup ? "自提" : "卡派";
      expenseLines.push({
        key: `unload-${isPickup ? "pickup" : "delivery"}-${point}`,
        category: isPickup ? "warehouse" : "transport",
        standardName: rule?.rule_name || `${methodLabel}费用未匹配（${group.warehousePoint || point}）`,
        condition: rejectionCount > 0
          ? `${isDirectRejectionUnload ? "改拆后" : ""}${methodLabel}预约；分仓比例 ${proportionLabel}；拒收重送 ${rejectionCount} 次`
          : `${isDirectRejectionUnload ? "改拆后" : ""}${methodLabel}预约；分仓比例 ${proportionLabel}`,
        warehousePoint: group.warehousePoint,
        quantity,
        unitAmount: rule?.amount || 0,
        amount,
        matched: Boolean(rule)
      });
    }

    for (const [point, allocation] of unresolved) {
      expenseLines.push({
        key: `unload-method-unmatched-${point}`,
        category: "transport",
        standardName: `${isDirectRejectionUnload ? "改拆后" : ""}配送方式未确定（${allocation.warehousePoint || point}）`,
        condition: `分仓比例 ${(allocation.proportion * 100).toFixed(2)}%；源系统暂无有效的自提或卡派预约`,
        warehousePoint: allocation.warehousePoint,
        quantity: allocation.proportion,
        unitAmount: 0,
        amount: 0,
        matched: false
      });
    }

    for (const [point, rejectionCount] of unknownRejections) {
      if (methodsByPoint.get(point)?.size === 1) continue;
      expenseLines.push({
        key: `unload-rejection-method-unmatched-${point}`,
        category: "transport",
        standardName: `拒收配送方式未确定（${point}）`,
        condition: `源系统存在 ${rejectionCount} 次拒收，但无法确认属于自提或卡派`,
        warehousePoint: point,
        quantity: rejectionCount,
        unitAmount: 0,
        amount: 0,
        matched: false
      });
    }
  }

  if (isDirect) {
    const directPoints = new Map<string, string | null>();
    for (const allocation of facts.warehouseAllocations || []) {
      const point = normalizedPoint(allocation.warehousePoint);
      if (point) directPoints.set(point, allocation.warehousePoint);
    }
    if (!directPoints.size) {
      for (const trip of facts.deliveryTrips || []) {
        const point = normalizedPoint(trip.warehousePoint);
        if (point) directPoints.set(point, trip.warehousePoint);
      }
    }

    for (const [point, warehousePoint] of directPoints) {
      const rule = transportRules.find(
        (item) => item.rule_type === "amazon_warehouse" && normalizedPoint(item.warehouse_point) === point
      );
      expenseLines.push({
        key: `direct-delivery-${point}`,
        category: "transport",
        standardName: rule?.rule_name || `送仓费用未匹配（${warehousePoint || point}）`,
        condition: "直送固定运输：按目的仓点计入一次完整车主价",
        warehousePoint,
        quantity: 1,
        unitAmount: rule?.amount || 0,
        amount: rule?.amount || 0,
        matched: Boolean(rule)
      });
    }
  }

  const expenses = expenseCategories.map((category) => {
    const rows = expenseLines.filter((item) => item.category === category.key && item.matched);
    return {
      ...category,
      amount: Number(rows.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
      lineCount: rows.length,
      source: "matched_standard"
    };
  });
  const totalExpense = Number(expenses.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  return { expenses, expenseLines, totalExpense };
}
