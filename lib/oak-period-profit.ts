import type { DriverTask } from "./oak-driver-types";
import { incomeAmount, incomeText, summarizeIncome, type IncomeSummary } from "./oak-income";
import { summarizePayeeTypes, type PayeeType } from "./oak-payee";
import { workflowDate, type SettlementAdjustment } from "./oak-workflow";

export type ProfitScope = { subject: string; dateFrom: string; dateTo: string; importId: number | null };
export type PeriodExpense = { title: string; amount: number };
export type PeriodCostInput = ProfitScope & {
  payeeType: PayeeType; laborMode: "settlements" | "manual"; laborAmount: number | null;
  expenses: PeriodExpense[]; expensesConfirmed: boolean; note: string; taskHash: string; version: number;
};
export type PeriodCostReview = PeriodCostInput & { updatedAt: string };
export type ProfitSettlement = {
  id: string; subject: string; weekStart: string; weekEnd: string; payeeType: PayeeType;
  baseAmount: number; adjustments: SettlementAdjustment[]; status: "draft" | "confirmed"; taskIds: string[];
};
export type PeriodProfit = {
  scope: ProfitScope; taskHash: string; payeeType: PayeeType | null; income: IncomeSummary;
  laborAmount: number | null; knownLaborAmount: number; laborMode: "settlements" | "manual";
  coveredTaskCount: number; taskCount: number; settlementLaborAmount: number | null; otherAmount: number | null; totalCost: number | null;
  net: number | null; status: "profit" | "loss" | "even" | "pending"; issues: string[];
  settlements: Array<{ id: string; from: string; to: string; amount: number }>;
  review: PeriodCostReview | null; staleReview: boolean;
};
export type ProfitSummary = {
  completeCount: number; pendingCount: number; profitCount: number; lossCount: number; evenCount: number;
  netAmount: number; revenueAmount: number; costAmount: number;
};
const cents = (amount: number) => Math.round(amount * 100);

export function validateProfitScope(value: Record<string, unknown>): ProfitScope {
  const dateFrom = workflowDate(value.dateFrom); const dateTo = workflowDate(value.dateTo);
  if (dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
  const importId = value.importId == null || value.importId === "" ? null : Number(value.importId);
  if (importId !== null && (!Number.isSafeInteger(importId) || importId <= 0)) throw new Error("导入批次无效");
  return { subject: incomeText(value.subject, 120, true)!, dateFrom, dateTo, importId };
}
export function validatePeriodCost(value: unknown): PeriodCostInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("周期成本内容无效");
  const body = value as Record<string, unknown>;
  if (body.payeeType !== "driver" && body.payeeType !== "owner") throw new Error("请选择司机工资或车主价格");
  if (body.laborMode !== "settlements" && body.laborMode !== "manual") throw new Error("报酬来源无效");
  if (body.expensesConfirmed !== true) throw new Error("请确认本周期车辆费用已核对完整");
  if (!Array.isArray(body.expenses) || body.expenses.length > 40) throw new Error("车辆费用最多 40 项");
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) throw new Error("成本版本无效，请刷新后重试");
  if (typeof body.taskHash !== "string" || !/^[a-f0-9]{64}$/.test(body.taskHash)) throw new Error("作业范围无效，请刷新后重试");
  const expenses = body.expenses.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("车辆费用内容无效");
    return { title: incomeText(item.title, 120, true)!, amount: costAmount(item.amount) };
  });
  const laborAmount = body.laborMode === "manual" ? costAmount(body.laborAmount) : null;
  const total = expenses.reduce((sum, item) => sum + cents(item.amount), cents(laborAmount || 0));
  if (!Number.isSafeInteger(total) || total > 999999999999) throw new Error("周期成本合计超出金额范围");
  return { ...validateProfitScope(body), payeeType: body.payeeType, laborMode: body.laborMode, laborAmount,
    expenses, expensesConfirmed: true, note: incomeText(body.note, 1000, true)!, taskHash: body.taskHash, version: Number(body.version) };
}
function costAmount(value: unknown) {
  try { return incomeAmount(value); } catch { throw new Error("成本金额需为非负数，最多两位小数；零费用请明确填写 0"); }
}
export function profitTaskSignature(tasks: DriverTask[]) {
  return JSON.stringify(tasks.map(task => [task.id, task.importId, task.driverName, task.sheetName, task.workDate, task.payeeType || null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export function calculatePeriodProfit(scope: ProfitScope, tasks: DriverTask[], settlements: ProfitSettlement[], review: PeriodCostReview | null, taskHash: string): PeriodProfit {
  const income = summarizeIncome(tasks); const identity = summarizePayeeTypes(tasks); const issues: string[] = [];
  const taskIds = new Set(tasks.map(task => task.id).filter((id): id is string => Boolean(id)));
  const sameScope = review && review.subject === scope.subject && review.dateFrom === scope.dateFrom && review.dateTo === scope.dateTo && review.importId === scope.importId;
  const staleReview = Boolean(review && (!sameScope || review.taskHash !== taskHash));
  const usableReview = !staleReview ? review : null;
  let payeeType = identity.type || usableReview?.payeeType || null;
  const covered = new Set<string>(); const used: PeriodProfit["settlements"] = [];
  let knownLaborCents = 0; let partial = false;
  for (const record of settlements) {
    if (record.subject !== scope.subject || record.status !== "confirmed" || record.weekStart > scope.dateTo || record.weekEnd < scope.dateFrom) continue;
    const snapshotIds = new Set(record.taskIds);
    const weekTasks = tasks.filter(task => task.workDate >= record.weekStart && task.workDate <= record.weekEnd);
    if (!weekTasks.length) continue;
    // A weekly amount is usable only with its entire week and exact locked source set.
    if (record.weekStart < scope.dateFrom || record.weekEnd > scope.dateTo || !snapshotIds.size ||
      snapshotIds.size !== weekTasks.length || weekTasks.some(task => !task.id || !snapshotIds.has(task.id)) ||
      record.taskIds.some(id => !taskIds.has(id) || covered.has(id)) || (payeeType && record.payeeType !== payeeType)) { partial = true; continue; }
    payeeType = payeeType || record.payeeType;
    // Advances/repayments reduce cash payable, not the cost of the work performed.
    const amount = cents(record.baseAmount) + record.adjustments.filter(item => item.kind === "allowance").reduce((sum, item) => sum + cents(item.amount), 0);
    knownLaborCents += amount; record.taskIds.forEach(id => covered.add(id));
    used.push({ id: record.id, from: record.weekStart, to: record.weekEnd, amount: amount / 100 });
  }
  const laborMode = usableReview?.laborMode || "settlements";
  const manual = laborMode === "manual" && usableReview?.laborAmount != null;
  const settlementLaborAmount = covered.size === tasks.length && tasks.length > 0 ? knownLaborCents / 100 : null;
  const laborAmount = manual ? usableReview!.laborAmount : settlementLaborAmount;
  const otherAmount = usableReview?.expensesConfirmed ? usableReview.expenses.reduce((sum, item) => sum + cents(item.amount), 0) / 100 : null;
  if (!tasks.length) issues.push("本周期无作业");
  if (identity.conflict || (identity.type && usableReview && identity.type !== usableReview.payeeType)) issues.push("结算身份待核对");
  if (income.pendingCount) issues.push(`${income.pendingCount} 段收入待计价`);
  if (laborAmount == null) issues.push(partial ? "周结算与所选周期或作业范围不完整匹配" : "工资／车主价格待核对");
  if (otherAmount == null) issues.push(staleReview ? "作业范围已变化，车辆费用需重新核对" : "车辆费用待核对");
  const totalCost = laborAmount != null && otherAmount != null ? (cents(laborAmount) + cents(otherAmount)) / 100 : null;
  const net = !issues.length && totalCost != null ? (cents(income.amount) - cents(totalCost)) / 100 : null;
  return { scope, taskHash, payeeType, income, laborAmount, knownLaborAmount: manual ? laborAmount! : knownLaborCents / 100,
    laborMode, coveredTaskCount: covered.size, taskCount: tasks.length, settlementLaborAmount, otherAmount, totalCost, net,
    status: net == null ? "pending" : net > 0 ? "profit" : net < 0 ? "loss" : "even", issues, settlements: used, review, staleReview };
}
export function summarizePeriodProfits(profits: PeriodProfit[]): ProfitSummary {
  const ready = profits.filter(profit => profit.net != null);
  return { completeCount: ready.length, pendingCount: profits.length - ready.length,
    profitCount: ready.filter(profit => profit.net! > 0).length, lossCount: ready.filter(profit => profit.net! < 0).length,
    evenCount: ready.filter(profit => profit.net === 0).length,
    netAmount: ready.reduce((sum, profit) => sum + cents(profit.net!), 0) / 100,
    revenueAmount: ready.reduce((sum, profit) => sum + cents(profit.income.amount), 0) / 100,
    costAmount: ready.reduce((sum, profit) => sum + cents(profit.totalCost!), 0) / 100 };
}
