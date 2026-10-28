import { calculateSavAccounting } from "./sav-accounting";
import { getSavSourceAccounting, SavSourceInputError } from "./sav-source-db";
import { readSavSettings } from "./sav-settings-db";
import { reconcileSav } from "./sav-baseline";
import { SavInputError, type SavSettings } from "./sav-settings";
import { parseSavQuery, type SavQueryScope } from "./sav-query";
import type { SavAccountingInput } from "./sav-accounting-types";

export function applySavSettings(input: SavAccountingInput, settings: SavSettings, scope: SavQueryScope = "excel"): SavAccountingInput {
  const incomeOverrides = scope === "all" ? settings.allIncomeOverrides || {} : settings.incomeOverrides;
  return {
    ...input, pricing: settings.pricing,
    goods: input.goods.map(goods => {
      const override = settings.goodsOverrides?.[goods.id];
      return override ? { ...goods, status: override.status, ...(override.method ? { method: override.method } : {}), sourceReference: `${goods.sourceReference || goods.id}；Finance状态核对：${override.note}` } : goods;
    }),
    containers: input.containers.map(row => ({ ...row, accountingScope: scope, ...(incomeOverrides[row.id] ? { sourceIncomeComplete: true } : {}) })),
    trips: input.trips.map(trip => {
      const override = settings.tripOverrides[trip.id];
      if (override?.goodsIds) {
        const current = input.goods.filter(goods => goods.tripId === trip.id).map(goods => goods.id).sort().join("|");
        if (current !== [...override.goodsIds].sort().join("|")) return trip;
      }
      if (!override) return trip;
      const next = { ...trip };
      const fields = ["miles", "stopCount", "explicitAmount"] as const;
      const calibrated = override.calibratedFields ?? (override.goodsIds ? fields.filter(key => override[key] !== undefined) : []);
      let applied = false;
      for (const key of fields) if (override[key] !== undefined && (!calibrated.includes(key) || trip[key] == null)) { next[key] = override[key]; applied = true; }
      if (applied) next.sourceReference = `${trip.sourceReference || trip.id}；Finance核对：${override.note}`;
      return next;
    }),
    incomeLines: [
      ...input.incomeLines.map(line => incomeOverrides[line.containerId] ? { ...line, category: "excluded" as const, label: `原账单（人工核对后不重复计入）：${line.label}` } : line),
      ...input.containers.flatMap(row => {
        const override = incomeOverrides[row.id];
        return override ? [{ id: `finance-income:${row.id}`, containerId: row.id, category: scope === "all" ? "other" as const : "delivery" as const, amount: override.amount, label: scope === "all" ? "Finance核对全部账单收入合计" : "Finance核对派送出库收入合计", sourceReference: override.note }] : [];
      })
    ]
  };
}
export async function loadSavAccounting(params: URLSearchParams, options: { allRows?: boolean } = {}) {
  const query = parseSavQuery(params);
  const { dateFrom, dateTo, scope, status } = query;
  const [source, settings] = await Promise.all([getSavSourceAccounting({ ...query, allRows: options.allRows }), readSavSettings()]);
  let input = applySavSettings(source.input, settings, scope);
  let result = calculateSavAccounting(input);
  if (status && status !== "all") {
    const ids = new Set(result.rows.filter(row => {
      const balance = scope === "all" ? row.transportBalance : row.profit;
      if (status === "pending") return balance === null;
      if (status === "missing_income") return row.income === null;
      if (status === "missing_cost") return row.expense === null;
      if (status === "loss") return balance !== null && balance < 0;
      if (status === "profit") return balance !== null && balance > 0;
      if (status === "stock") return row.inStockPallets > 0;
      throw new SavInputError("核算状态无效");
    }).map(row => row.id));
    input = { ...input, containers: input.containers.filter(row => ids.has(row.id)) };
    result = calculateSavAccounting(input);
  }
  return {
    ...result, settings: { ...settings, incomeOverrides: scope === "all" ? settings.allIncomeOverrides || {} : settings.incomeOverrides },
    pagination: source.pagination, operationModes: source.operationModes,
    source: { snapshotAt: source.snapshotAt, notes: source.notes, selection: source.selection, label: source.source, dateFrom: dateFrom || null, dateTo: dateTo || null, scope },
    reconciliation: scope === "excel" ? reconcileSav(result.rows, settings.baseline) : reconcileSav([], undefined)
  };
}
export function savApiError(error: unknown) {
  return { error: error instanceof SavInputError || error instanceof SavSourceInputError ? error.message : "读取SAV核算失败，请检查SAV与Finance数据库连接及数据结构" };
}
