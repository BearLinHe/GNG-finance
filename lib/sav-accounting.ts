import type {
  SavAccountingInput, SavAccountingResult, SavAccountingSummary,
  SavContainerResult, SavCostLine, SavGoodsInput, SavPricingRule,
  SavTripInput, SavTripResult
} from "./sav-accounting-types";

export const DEFAULT_SAV_PRICING: SavPricingRule = {
  perMile: 4.3,
  roundingUnit: 50,
  minimumTrip: 200,
  additionalStop: 200,
  pickupPerPallet: 10
};

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonnegative(value: unknown): value is number {
  return numeric(value) && value >= 0;
}

// Excel ROUND uses half away from zero; Math.round differs for negative halves.
export function savRound(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON) / factor;
}

function sumMoney(values: number[]): number {
  return values.reduce((sum, value) => sum + Math.round(savRound(value) * 100), 0) / 100;
}

function assertUnique(rows: Array<{ id: string }>, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) throw new Error(`${label}存在空白或重复 ID：${row.id}`);
    seen.add(row.id);
  }
}

function goodsOrder(a: SavGoodsInput, b: SavGoodsInput) {
  if (numeric(a.allocationOrder) && numeric(b.allocationOrder) && a.allocationOrder !== b.allocationOrder) {
    return a.allocationOrder - b.allocationOrder;
  }
  return a.id.localeCompare(b.id, "en", { numeric: true });
}

function kind(method: string): "pickup" | "ltl" | "transport" | "unknown" {
  const normalized = method.trim().toLowerCase();
  if (["自提", "pickup", "pick up"].includes(normalized)) return "pickup";
  if (normalized === "ltl") return "ltl";
  if (["卡派", "私仓", "直送", "delivery", "private", "direct"].includes(normalized)) return "transport";
  return "unknown";
}

function priceTrip(trip: SavTripInput, goods: SavGoodsInput[], pricing: SavPricingRule, pending: boolean): SavTripResult {
  const warnings: string[] = [];
  let amount: number | null = null;
  let pricingBasis = "待确认运输成本";
  const loadedPallets = goods.reduce((sum, item) => sum + (nonnegative(item.loadedPallets) ? item.loadedPallets : 0), 0);
  const modes = new Set(goods.map(item => kind(item.method)));
  if (pending) warnings.push("趟次存在状态未确认货物，分摊范围待核对");
  if (goods.some(item => !nonnegative(item.loadedPallets))) warnings.push("趟次存在装运板数缺失或无效的货物");
  if (goods.some(item => nonnegative(item.rejectedPallets) && nonnegative(item.loadedPallets) && item.rejectedPallets > item.loadedPallets!)) {
    warnings.push("拒收板数大于装运板数");
  }
  if (goods.some(item => item.rejectedPallets !== null && !nonnegative(item.rejectedPallets))) warnings.push("拒收板数无效");
  if (loadedPallets <= 0) warnings.push("整趟装运板数为零，无法分摊成本");
  if (trip.explicitAmount !== null && trip.explicitAmount !== undefined) {
    if (!nonnegative(trip.explicitAmount)) warnings.push("确认运费无效");
    else {
      amount = savRound(trip.explicitAmount);
      pricingBasis = `确认整趟运费 $${amount.toFixed(2)}，按原装运板数分摊`;
    }
  } else if (modes.has("unknown") || (modes.has("ltl") && modes.size > 1)) {
    warnings.push("运输方式未确认或同趟方式混合，需确认整趟运费");
  } else if (modes.has("ltl")) {
    warnings.push("缺少 LTL 实际运费");
  } else {
    if (!nonnegative(trip.miles)) warnings.push("缺少有效单程英里");
    if (!numeric(trip.stopCount) || !Number.isInteger(trip.stopCount) || trip.stopCount < 1) warnings.push("缺少有效卸货点数");
    if (nonnegative(trip.miles) && numeric(trip.stopCount) && Number.isInteger(trip.stopCount) && trip.stopCount >= 1) {
      const base = Math.max(pricing.minimumTrip, savRound(trip.miles * pricing.perMile / pricing.roundingUnit, 0) * pricing.roundingUnit);
      amount = savRound(base + (trip.stopCount - 1) * pricing.additionalStop);
      pricingBasis = `${trip.miles} 英里 × $${pricing.perMile}，按 $${pricing.roundingUnit} 取整且最低 $${pricing.minimumTrip}；${trip.stopCount - 1} 个额外卸点 × $${pricing.additionalStop}；按原装运板数分摊`;
    }
  }
  if (warnings.length) amount = null;
  return { ...trip, amount, loadedPallets, goodsCount: goods.length, pricingBasis, warnings };
}

export function calculateSavAccounting(input: SavAccountingInput): SavAccountingResult {
  assertUnique(input.containers, "柜号");
  assertUnique(input.goods, "货物明细");
  assertUnique(input.trips, "趟次");
  assertUnique(input.incomeLines, "收入明细");
  const pricing = { ...DEFAULT_SAV_PRICING, ...input.pricing };
  if (Object.values(pricing).some(value => !nonnegative(value)) || pricing.roundingUnit <= 0) {
    throw new Error("SAV 计价参数须为有效非负数，取整单位须大于零");
  }
  const lines = new Map<string, SavCostLine>();
  const tripGoods = new Map<string, SavGoodsInput[]>();
  const pendingTrips = new Set(input.goods.filter(item => item.status === "pending" && item.tripId).map(item => item.tripId));
  for (const item of input.goods) {
    const line: SavCostLine = { ...item, netPallets: nonnegative(item.loadedPallets) && (item.rejectedPallets === null || nonnegative(item.rejectedPallets))
      ? Math.max(0, item.loadedPallets - (item.rejectedPallets || 0)) : null,
    amount: null, pricingBasis: "", warnings: [] };
    lines.set(item.id, line);
    if (item.status === "in_stock" || item.status === "returned") {
      line.pricingBasis = item.status === "in_stock" ? "在库，未计入正常运输支出" : "退运，未计入正常运输支出";
      if (!nonnegative(item.loadedPallets)) line.warnings.push("板数缺失或无效");
      continue;
    }
    if (item.status === "pending") {
      line.warnings.push("运输状态待确认");
      continue;
    }
    if (kind(item.method) === "pickup") {
      if (!nonnegative(item.loadedPallets) || item.loadedPallets === 0) line.warnings.push("自提装运板数缺失或为零");
      else {
        line.amount = savRound(item.loadedPallets * pricing.pickupPerPallet);
        line.pricingBasis = `原装运 ${item.loadedPallets} 板 × $${pricing.pickupPerPallet}/板`;
      }
      continue;
    }
    if (!item.tripId) {
      line.warnings.push("未关联计价趟次");
      continue;
    }
    const group = tripGoods.get(item.tripId) || [];
    group.push(item);
    tripGoods.set(item.tripId, group);
  }
  const trips: SavTripResult[] = [];
  const tripById = new Map(input.trips.map(item => [item.id, item]));
  for (const [tripId, goods] of tripGoods) {
    const trip = tripById.get(tripId);
    if (!trip) {
      for (const item of goods) lines.get(item.id)!.warnings.push("计价趟次资料缺失");
      continue;
    }
    const result = priceTrip(trip, goods, pricing, pendingTrips.has(tripId));
    trips.push(result);
    if (result.amount !== null) {
      const ordered = [...goods].sort(goodsOrder);
      const positive = ordered.filter(item => item.loadedPallets! > 0);
      let allocatedCents = 0;
      const totalCents = Math.round(result.amount * 100);
      for (const item of ordered) {
        const line = lines.get(item.id)!;
        const cents = item.loadedPallets === 0 ? 0 : item === positive[positive.length - 1]
          ? totalCents - allocatedCents
          : Math.round(savRound(result.amount * item.loadedPallets! / result.loadedPallets) * 100);
        line.amount = cents / 100;
        allocatedCents += cents;
      }
      if (ordered.some(item => lines.get(item.id)!.amount! < 0)) {
        result.amount = null;
        result.warnings.push("逐行取整产生负数尾差，需核对分摊金额");
        for (const item of ordered) lines.get(item.id)!.amount = null;
      }
    }
    for (const item of goods) {
      const line = lines.get(item.id)!;
      line.pricingBasis = result.pricingBasis;
      line.warnings.push(...result.warnings);
    }
  }

  const rows: SavContainerResult[] = input.containers.map(container => {
    const goods = input.goods.filter(item => item.containerId === container.id).map(item => lines.get(item.id)!);
    const incomeLines = input.incomeLines.filter(item => item.containerId === container.id);
    const included = incomeLines.filter(item => item.category === "delivery" || item.category === "labor" || item.category === "other");
    const incomeUnknown = incomeLines.some(item => item.category === "unclassified" || ((item.category === "delivery" || item.category === "labor" || item.category === "other") && !numeric(item.amount)));
    const incomeStatus = incomeUnknown ? "pending" : included.length || container.sourceIncomeComplete ? "complete" : "missing";
    const deliveryIncome = sumMoney(included.filter(item => item.category === "delivery" && numeric(item.amount)).map(item => item.amount!));
    const laborIncome = sumMoney(included.filter(item => item.category === "labor" && numeric(item.amount)).map(item => item.amount!));
    const otherIncome = sumMoney(included.filter(item => item.category === "other" && numeric(item.amount)).map(item => item.amount!));
    const knownIncome = sumMoney([deliveryIncome, laborIncome, otherIncome]);
    const income = incomeStatus === "complete" ? knownIncome : null;
    const transport = goods.filter(item => item.status === "transport" || item.status === "pending");
    const pendingCostCount = transport.filter(item => item.amount === null).length;
    const knownExpense = sumMoney(transport.filter(item => item.amount !== null).map(item => item.amount!));
    const expenseStatus = pendingCostCount ? "pending" : transport.length || container.sourceExpenseComplete ? "complete" : "missing";
    const expense = expenseStatus === "complete" ? knownExpense : null;
    const transportBalance = income !== null && expense !== null ? sumMoney([income, -expense]) : null;
    const profit = container.accountingScope === "all" ? null : transportBalance;
    const inStockPallets = goods.filter(item => item.status === "in_stock").reduce((sum, item) => sum + (nonnegative(item.loadedPallets) ? item.loadedPallets : 0), 0);
    const returnedPallets = goods.filter(item => item.status === "returned").reduce((sum, item) => sum + (nonnegative(item.loadedPallets) ? item.loadedPallets : 0), 0);
    const provisional = container.accountingScope === "all" || goods.some(item => item.status === "in_stock" || item.status === "returned");
    const warnings = [...new Set(goods.flatMap(item => item.warnings))];
    if (incomeStatus === "missing") warnings.unshift(container.accountingScope === "all" ? "暂无有效账单收入记录" : "缺少本核算范围的派送费、出库等人工费收入记录");
    if (incomeStatus === "pending") warnings.unshift("收入存在未分类项目或缺失金额，需核对核算范围");
    if (expenseStatus === "missing") warnings.push("暂无正常运输支出依据");
    if (container.accountingScope === "all") warnings.push("收入汇总全部有效账单，支出当前仅接入运输计价；其他成本尚未完整接入，收入减运输支出为阶段差额，整柜利润待核对");
    else if (provisional) warnings.push("含在库或退运货物，利润仅覆盖当前正常运输支出，非整柜最终利润");
    return { ...container, income, knownIncome, deliveryIncome, laborIncome, otherIncome, expense, knownExpense, profit, transportBalance,
      incomeStatus, expenseStatus, pendingCostCount, provisional,
      statusLabel: container.accountingScope === "all" ? transportBalance === null ? "费用待核对" : "阶段核算（运输）" : profit === null ? "待核对" : provisional ? "阶段核算" : profit > 0 ? "盈利" : profit < 0 ? "亏损" : "持平",
      inStockPallets, returnedPallets, goods, incomeLines, warnings };
  });
  const complete = rows.filter(item => item.profit !== null);
  const knownIncome = sumMoney(rows.map(item => item.knownIncome));
  const knownExpense = sumMoney(rows.map(item => item.knownExpense));
  const allIncome = rows.every(item => item.income !== null);
  const allExpense = rows.every(item => item.expense !== null);
  const summary: SavAccountingSummary = {
    containerCount: rows.length,
    income: allIncome ? knownIncome : null,
    knownIncome,
    expense: allExpense ? knownExpense : null,
    knownExpense,
    profit: complete.length === rows.length ? sumMoney(complete.map(item => item.profit!)) : null,
    comparableProfit: sumMoney(complete.map(item => item.profit!)),
    transportBalance: rows.some(item => item.transportBalance !== null) ? sumMoney(rows.filter(item => item.transportBalance !== null).map(item => item.transportBalance!)) : null,
    calculatedBalanceCount: rows.filter(item => item.transportBalance !== null).length,
    completeCount: complete.length,
    provisionalCount: rows.filter(item => item.provisional).length,
    missingIncomeCount: rows.filter(item => item.income === null).length,
    pendingCostCount: rows.reduce((sum, item) => sum + item.pendingCostCount, 0),
    pendingContainerCount: rows.length - complete.length,
    profitableCount: complete.filter(item => item.profit! > 0).length,
    lossCount: complete.filter(item => item.profit! < 0).length,
    breakEvenCount: complete.filter(item => item.profit === 0).length,
    inStockPallets: rows.reduce((sum, item) => sum + item.inStockPallets, 0),
    returnedPallets: rows.reduce((sum, item) => sum + item.returnedPallets, 0)
  };
  return { rows, summary, trips, pricing };
}
