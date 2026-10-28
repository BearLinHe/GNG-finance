import type { SavGoodsStatus, SavPricingRule } from "./sav-accounting-types";

export class SavInputError extends Error {}
export type SavTripOverride = { miles?: number | null; stopCount?: number | null; explicitAmount?: number | null; goodsIds?: string[]; calibratedFields?: Array<"miles" | "stopCount" | "explicitAmount">; note: string };
export type SavIncomeOverride = { amount: number; note: string };
export type SavGoodsOverride = { status: SavGoodsStatus; method?: string; note: string };
export type SavTripEvidence = { id: string; goodsIds: string[]; miles: number | null; stopCount: number | null; explicitAmount?: number | null; sourceReference: string };
export type SavBaselineContainer = { containerNumber: string; income: number | null; expense: number | null; profit: number | null };
export type SavBaseline = { importedAt: string; sourceName: string; containers: SavBaselineContainer[]; transport?: { sourceName: string; goodsCount: number; knownExpense: number }; tripEvidence?: SavTripEvidence[] };
export type SavSettings = { pricing: SavPricingRule; tripOverrides: Record<string, SavTripOverride>; incomeOverrides: Record<string, SavIncomeOverride>; allIncomeOverrides: Record<string, SavIncomeOverride>; goodsOverrides: Record<string, SavGoodsOverride>; baseline?: SavBaseline };
export const SAV_DEFAULT_PRICING: SavPricingRule = { perMile: 4.3, roundingUnit: 50, minimumTrip: 200, additionalStop: 200, pickupPerPallet: 10 };
export function defaultSavSettings(): SavSettings { return { pricing: { ...SAV_DEFAULT_PRICING }, tripOverrides: {}, incomeOverrides: {}, allIncomeOverrides: {}, goodsOverrides: {} }; }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SavInputError("提交内容必须为对象");
  return value as Record<string, unknown>;
}
function amount(value: unknown, label: string, allowNegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0) || Math.abs(value) > 10000000) throw new SavInputError(`${label}金额或数值无效`);
  return value;
}
function note(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new SavInputError("请填写核对依据（最多1000字）");
  return value.trim();
}
export function mergeSavSettings(current: SavSettings, value: unknown): SavSettings {
  const input = object(value);
  if (Object.keys(input).some(key => !["pricing", "tripOverrides", "incomeOverrides", "allIncomeOverrides", "goodsOverrides"].includes(key))) throw new SavInputError("包含不支持的设置项目");
  const next: SavSettings = structuredClone(current);
  if (input.pricing !== undefined) for (const [key, value] of Object.entries(object(input.pricing))) {
    if (!Object.prototype.hasOwnProperty.call(SAV_DEFAULT_PRICING, key)) throw new SavInputError("计价参数无效");
    const number = amount(value, "计价参数");
    if (key === "roundingUnit" && number <= 0) throw new SavInputError("四舍五入单位必须大于零");
    next.pricing[key as keyof SavPricingRule] = number;
  }
  next.goodsOverrides ||= {};
  next.allIncomeOverrides ||= {};
  for (const field of ["tripOverrides", "incomeOverrides", "allIncomeOverrides", "goodsOverrides"] as const) {
    if (input[field] === undefined) continue;
    const entries = Object.entries(object(input[field]));
    if (entries.length > 500) throw new SavInputError("单次最多核对500条");
    for (const [id, raw] of entries) {
      if (!/^[\w:.-]{1,120}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new SavInputError("记录编号无效");
      if (raw === null) { delete next[field][id]; continue; }
      const row = object(raw);
      if (field === "goodsOverrides") {
        if (Object.keys(row).some(key => !["status", "method", "note"].includes(key)) || !["transport", "in_stock", "returned", "pending"].includes(String(row.status))) throw new SavInputError("货物状态无效");
        if (row.method !== undefined && !["自提", "私仓", "卡派", "LTL", "直送"].includes(String(row.method))) throw new SavInputError("运输方式无效");
        next.goodsOverrides[id] = { status: row.status as SavGoodsStatus, ...(row.method === undefined ? {} : { method: String(row.method) }), note: note(row.note) };
      } else if (field === "incomeOverrides" || field === "allIncomeOverrides") {
        if (Object.keys(row).some(key => !["amount", "note"].includes(key))) throw new SavInputError("收入核对字段无效");
        next[field][id] = { amount: Math.round(amount(row.amount, "收入", true) * 100) / 100, note: note(row.note) };
      } else {
        if (Object.keys(row).some(key => !["miles", "stopCount", "explicitAmount", "goodsIds", "calibratedFields", "note"].includes(key))) throw new SavInputError("趟次核对字段无效");
        const result: SavTripOverride = { note: note(row.note) };
        for (const key of ["miles", "stopCount", "explicitAmount"] as const) if (row[key] !== undefined) {
          const number = row[key] === null ? null : amount(row[key], "趟次参数");
          if (key === "stopCount" && number !== null && (!Number.isInteger(number) || number < 1)) throw new SavInputError("卸货点数必须为正整数");
          result[key] = number;
        }
        if (Object.keys(result).length === 1) throw new SavInputError("请至少填写一项趟次参数");
        if (row.goodsIds !== undefined) {
          if (!Array.isArray(row.goodsIds) || !row.goodsIds.length || row.goodsIds.length > 3000 || row.goodsIds.some(id => typeof id !== "string" || !/^[\w:.-]{1,120}$/.test(id))) throw new SavInputError("趟次货物依据无效");
          result.goodsIds = row.goodsIds as string[];
        }
        if (row.calibratedFields !== undefined) {
          if (!Array.isArray(row.calibratedFields) || row.calibratedFields.some(key => !["miles", "stopCount", "explicitAmount"].includes(String(key)) || row[String(key)] === undefined) || !result.goodsIds) throw new SavInputError("补齐字段依据无效");
          result.calibratedFields = row.calibratedFields as SavTripOverride["calibratedFields"];
        }
        next.tripOverrides[id] = result;
      }
    }
  }
  return next;
}
export function savDate(value: string | null, fallback: string) {
  const date = value || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new SavInputError("日期无效");
  return date;
}
