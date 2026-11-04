import { incomeAmount, incomeText, summarizeIncome, type IncomeSummary } from "./oak-income";
import type { DriverTask } from "./oak-driver-types";
import { calculatePeriodProfit, type ProfitSettlement } from "./oak-period-profit";
import { workflowDate } from "./oak-workflow";
import type { PayeeType } from "./oak-payee";
import type { OakVehicle } from "./oak-vehicles";
import type { AllocatedVehicleAmount } from "./oak-vehicle-amounts";
import type {RepairFeedStatus} from './oak-repair';

export const vehicleFields = ["income", "labor", "fuel", "maintenance", "insurance"] as const;
export type VehicleField = typeof vehicleFields[number];
export const vehicleAccountingViews = ["vehicles", "maintenance", "labor", "insurance", "fuel", "income"] as const;
export type VehicleAccountingView = typeof vehicleAccountingViews[number];
export const vehicleViewLabels: Record<VehicleAccountingView, string> = {
  vehicles: "单车核算", maintenance: "维修费", labor: "司机工资", insurance: "车辆保险", fuel: "油费", income: "车辆收入"
};
export function isVehicleAccountingView(value: string): value is VehicleAccountingView {
  return (vehicleAccountingViews as readonly string[]).includes(value);
}
export const vehicleFieldLabels: Record<VehicleField, string> = { income: "周期收入", labor: "司机工资 / 车主工资", fuel: "周期油费", maintenance: "车辆维修费", insurance: "车辆保险" };
export type VehicleEntry = { mode: "auto" | "manual"; amount: number | null };
export type VehicleEntries = Record<VehicleField, VehicleEntry>;
export type VehicleRange = { dateFrom: string; dateTo: string };
export type VehicleAccountingInput = VehicleRange & {
  vehicleId: string; entries: VehicleEntries; payeeType: PayeeType; otherExpenses: Array<{ title: string; amount: number }>;
  note: string; sourceHash: string; version: number;
  changedFields?: VehicleField[]; otherChanged?: boolean;
};
export type VehicleAccountingReview = VehicleAccountingInput & { updatedAt: string };
export type VehicleAccountingLine = { amount: number | null; source: "auto" | "manual" | "ledger" | "missing"; basis: string; notApplicable?: boolean;
  knownAmount?: number; pendingReason?: string; missingWorkDates?: string[] };
export function applyOwnerVehicleCosts(lines: Record<VehicleField, VehicleAccountingLine>, owner: boolean) {
  if (!owner) return;
  for (const field of ['maintenance', 'insurance'] as const) lines[field] = { amount: 0, source: 'auto', notApplicable: true,
    basis: `车主车辆不计${field === 'maintenance' ? '维修费' : '车辆保险'}` };
}
export type VehicleAccountingRow = VehicleRange & {
  vehicle: OakVehicle; subjects: string[]; taskCount: number; dayCount: number; miles: number | null;
  incomeSummary: IncomeSummary; autoIncome: number | null; autoLabor: number | null; autoPayeeType: PayeeType; payeeType: PayeeType;
  laborSources: Array<{ id: string; subject: string; from: string; to: string; amount: number }>;
  lines: Record<VehicleField, VehicleAccountingLine>; otherAmount: number; totalCost: number | null;
  net: number | null; status: "profit" | "loss" | "even" | "pending"; issues: string[];
  sourceHash: string; stale: boolean; review: VehicleAccountingReview | null;
  history: VehicleRange[];
  amounts?: AllocatedVehicleAmount[];
};
export type VehicleAccountingResponse = {
  repairStatus?:RepairFeedStatus;
  dateFrom: string; dateTo: string; rows: VehicleAccountingRow[]; vehicles: OakVehicle[];
  subjects: Array<{ name: string; vehicleId: string | null; taskCount: number }>;
  summary: { complete: number; pending: number; income: number; cost: number; net: number };
};
export function vehicleRange(body: Record<string, unknown>): VehicleRange {
  const dateFrom = workflowDate(body.dateFrom); const dateTo = workflowDate(body.dateTo);
  if (dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
  if ((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 1095) throw new Error("单次核算周期不能超过三年");
  return { dateFrom, dateTo };
}
export function defaultVehicleEntries(): VehicleEntries {
  return { income: { mode: "auto", amount: null }, labor: { mode: "auto", amount: null },
    fuel: { mode: "manual", amount: null }, maintenance: { mode: "manual", amount: null }, insurance: { mode: "manual", amount: null } };
}
export function validateVehicleAccounting(value: unknown): VehicleAccountingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("核算内容无效");
  const body = value as Record<string, unknown>;
  if (body.payeeType !== "driver" && body.payeeType !== "owner") throw new Error("请选择司机工资或车主工资");
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) throw new Error("核算版本无效");
  if (typeof body.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceHash)) throw new Error("数据范围无效，请重新读取");
  if (!body.entries || typeof body.entries !== "object" || Array.isArray(body.entries)) throw new Error("核算项目无效");
  const entries = defaultVehicleEntries();
  for (const key of vehicleFields) {
    const item = (body.entries as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    if (!item || (item.mode !== "auto" && item.mode !== "manual")) throw new Error("核算来源无效");
    if (item.mode === "auto" && key !== "income" && key !== "labor") throw new Error("此费用尚无自动数据来源");
    entries[key] = { mode: item.mode, amount: item.mode === "manual" && item.amount !== null && item.amount !== "" ? incomeAmount(item.amount) : null };
  }
  if (!Array.isArray(body.otherExpenses) || body.otherExpenses.length > 30) throw new Error("其他费用最多 30 项");
  const otherExpenses = body.otherExpenses.map(item => ({ title: incomeText(item?.title, 120, true)!, amount: incomeAmount(item?.amount) }));
  const manual = Object.values(entries).some(item => item.mode === "manual" && item.amount != null) || otherExpenses.length;
  if (body.changedFields != null && (!Array.isArray(body.changedFields) || body.changedFields.some(key => !vehicleFields.includes(key)))) throw new Error("修改项目无效");
  if (body.otherChanged != null && typeof body.otherChanged !== "boolean") throw new Error("其他费用修改标记无效");
  return { ...vehicleRange(body), vehicleId: incomeText(body.vehicleId, 60, true)!, entries, payeeType: body.payeeType,
    otherExpenses, note: incomeText(body.note, 1000, Boolean(manual)) || "", sourceHash: body.sourceHash, version: Number(body.version),
    changedFields: body.changedFields as VehicleField[] | undefined, otherChanged: body.otherChanged as boolean | undefined };
}
export function vehicleAutomaticAmounts(vehicle: OakVehicle, range: VehicleRange, tasks: DriverTask[], settlements: ProfitSettlement[]) {
  const income = summarizeIncome(tasks);
  const subjects = [...new Set(tasks.map(task => task.driverName))].sort();
  const profits = subjects.map(subject => calculatePeriodProfit({ subject, ...range, importId: null }, tasks.filter(task => task.driverName === subject), settlements, null, ""));
  const roles = new Set(profits.map(profit => profit.payeeType).filter(Boolean));
  const laborSources = profits.flatMap(profit => profit.settlements.map(item => ({ ...item, subject: profit.scope.subject })));
  const autoLabor = profits.length && roles.size === 1 && profits.every(profit => profit.settlementLaborAmount != null && !profit.issues.includes("结算身份待核对")) ?
    profits.reduce((sum, profit) => sum + Math.round(profit.settlementLaborAmount! * 100), 0) / 100 : null;
  return { income, subjects, autoIncome: tasks.length && !income.pendingCount ? income.amount : null, autoLabor,
    payeeType: (roles.size === 1 ? [...roles][0] : "driver") as PayeeType, laborSources };
}
export function calculateVehicleAccounting(vehicle: OakVehicle, range: VehicleRange, tasks: DriverTask[], settlements: ProfitSettlement[], review: VehicleAccountingReview | null, sourceHash: string): VehicleAccountingRow {
  const auto = vehicleAutomaticAmounts(vehicle, range, tasks, settlements);
  const stale = Boolean(review && (review.sourceHash !== sourceHash || review.vehicleId !== vehicle.id || review.dateFrom !== range.dateFrom || review.dateTo !== range.dateTo));
  const usable = stale ? null : review;
  const lines = {} as VehicleAccountingRow["lines"];
  for (const key of vehicleFields) {
    const entry = usable?.entries[key] || defaultVehicleEntries()[key];
    const amount = entry.mode === "manual" ? entry.amount : key === "income" ? auto.autoIncome : key === "labor" ? auto.autoLabor : null;
    const basis = entry.mode === "manual" ? amount == null ? "待填写" : "人工核定" : key === "income" ?
      `${auto.income.pricedCount} 段已计价 · ${auto.income.pendingCount} 段待计价` : auto.autoLabor == null ? "暂无完整匹配的已确认周结算" : `${auto.laborSources.length} 笔已确认周结算 · 扣款前`;
    lines[key] = { amount, source: amount == null ? "missing" : entry.mode, basis };
  }
  const payeeType = usable?.entries.labor.mode === 'manual' ? usable.payeeType : auto.payeeType;
  applyOwnerVehicleCosts(lines, payeeType === 'owner');
  const issues = vehicleFields.filter(key => lines[key].amount == null).map(key => `${vehicleFieldLabels[key]}待核对`);
  if (!vehicle.vehicleNumber) issues.unshift("车号待补充");
  if (stale) issues.unshift("数据已变化，请重新核对人工项目");
  const otherAmount = (usable?.otherExpenses || []).reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
  const costs = [lines.labor.amount, lines.fuel.amount, lines.maintenance.amount, lines.insurance.amount];
  const totalCost = costs.every(amount => amount != null) ? (costs.reduce<number>((sum, amount) => sum + Math.round(amount! * 100), 0) + Math.round(otherAmount * 100)) / 100 : null;
  const net = !issues.length && totalCost != null && lines.income.amount != null ? (Math.round(lines.income.amount * 100) - Math.round(totalCost * 100)) / 100 : null;
  const miles = tasks.filter(task => task.miles != null).map(task => task.miles!);
  return { ...range, vehicle, subjects: auto.subjects, taskCount: tasks.length, dayCount: new Set(tasks.map(task => task.workDate)).size,
    miles: miles.length ? miles.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100 : null,
    incomeSummary: auto.income, autoIncome: auto.autoIncome, autoLabor: auto.autoLabor, autoPayeeType: auto.payeeType,
    payeeType,
    laborSources: auto.laborSources, lines, otherAmount, totalCost, net, status: net == null ? "pending" : net > 0 ? "profit" : net < 0 ? "loss" : "even",
    issues, sourceHash, stale, review, history: [] };
}
