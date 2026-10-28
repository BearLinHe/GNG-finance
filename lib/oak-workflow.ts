import { incomeAmount, incomeText, summarizeIncome, type IncomeSummary } from "./oak-income";
import { driverTaskLabel, type DriverTask } from "./oak-driver-types";
import { summarizePayeeTypes, taskPayeeType, type PayeeType } from "./oak-payee";

export type TransportJob = {
  id: string; primary: DriverTask | null; legs: DriverTask[]; subject: string;
  dateFrom: string; dateTo: string; miles: number | null; amount: number | null;
};
export function transportJobs(tasks: DriverTask[]): TransportJob[] {
  const groups = new Map<string, DriverTask[]>();
  for (const task of tasks) {
    if (!task.id) continue;
    const id = task.income?.review?.mode === "included" ? task.income.includedTaskId || task.id : task.id;
    groups.set(id, [...(groups.get(id) || []), task]);
  }
  return [...groups.entries()].map(([id, legs]) => {
    const primary = legs.find(task => task.id === id) || null;
    const dates = legs.map(task => task.workDate).sort();
    const miles = legs.map(task => task.miles).filter((value): value is number => value != null);
    return { id, primary, legs: [...legs].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.sourceRow - b.sourceRow), subject: legs[0].driverName,
      dateFrom: dates[0], dateTo: dates.at(-1)!, miles: miles.length ? Math.round(miles.reduce((sum, value) => sum + value, 0) * 100) / 100 : null,
      amount: primary?.income?.status === "priced" ? primary.income.amount : null };
  }).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.subject.localeCompare(b.subject, "zh-CN") || a.id.localeCompare(b.id));
}
export function workflowDate(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("日期无效");
  return value;
}
export function settlementWeek(value: string) {
  const date = new Date(`${workflowDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 1) % 7);
  const start = date.toISOString().slice(0, 10); date.setUTCDate(date.getUTCDate() + 6);
  return { start, end: date.toISOString().slice(0, 10) };
}
export type SettlementAdjustment = { kind: "allowance" | "deduction"; title: string; amount: number };
export type SettlementInput = {
  subject: string; weekStart: string; payeeName: string; payeeType: "driver" | "owner";
  baseAmount: number; adjustments: SettlementAdjustment[]; note: string;
};
export function settlementTotals(input: Pick<SettlementInput, "baseAmount" | "adjustments">) {
  const base = Math.round(incomeAmount(input.baseAmount) * 100);
  let allowance = 0; let deduction = 0;
  for (const item of input.adjustments) {
    const cents = Math.round(incomeAmount(item.amount) * 100);
    if (item.kind === "allowance") allowance += cents; else deduction += cents;
  }
  const total = base + allowance - deduction;
  if (!Number.isSafeInteger(total) || total < 0 || total > 999999999999) throw new Error("应付合计不能为负数或超出金额范围");
  return { baseAmount: base / 100, allowance: allowance / 100, deduction: deduction / 100, totalAmount: total / 100 };
}
export function validateSettlement(value: unknown): SettlementInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("结算内容无效");
  const body = value as Record<string, unknown>;
  const weekStart = workflowDate(body.weekStart);
  if (settlementWeek(weekStart).start !== weekStart) throw new Error("结算周期需从周六开始");
  if (body.payeeType !== "driver" && body.payeeType !== "owner") throw new Error("请选择司机工资或车主结算");
  if (!Array.isArray(body.adjustments) || body.adjustments.length > 50) throw new Error("补贴扣款最多 50 项");
  const adjustments = body.adjustments.map(value => {
    if (!value || typeof value !== "object" || (value.kind !== "allowance" && value.kind !== "deduction")) throw new Error("补贴扣款类型无效");
    return { kind: value.kind as SettlementAdjustment["kind"], title: incomeText(value.title, 120, true)!, amount: incomeAmount(value.amount) };
  });
  const input: SettlementInput = { subject: incomeText(body.subject, 120, true)!, weekStart, payeeName: incomeText(body.payeeName, 150, true)!, payeeType: body.payeeType,
    baseAmount: incomeAmount(body.baseAmount), adjustments, note: incomeText(body.note, 1000, true)! };
  settlementTotals(input); return input;
}
export type SettlementSnapshot = {
  version: 1; subject: string; weekStart: string; weekEnd: string; revenue: IncomeSummary; jobCount: number;
  payeeType?: PayeeType | null; payeeConflict?: boolean;
  tasks: Array<{ id: string; date: string; work: string; reference: string | null; from: string | null; to: string | null;
    miles: number | null; file: string; sheet: string; row: number; income: DriverTask["income"]; rawCells: DriverTask["rawCells"]; payeeType?: PayeeType | null }>;
};
export function settlementSnapshot(subject: string, weekStart: string, tasks: DriverTask[]): SettlementSnapshot {
  const week = settlementWeek(weekStart);
  if (!tasks.length) throw new Error("本周没有作业，不能生成作业结算单");
  if (tasks.length > 3000) throw new Error("单张结算单最多 3000 段作业");
  if (tasks.some(task => !task.id || task.driverName !== subject || task.workDate < week.start || task.workDate > week.end)) throw new Error("结算作业不属于所选司机及周期");
  const identity = summarizePayeeTypes(tasks);
  return { version: 1, subject, weekStart: week.start, weekEnd: week.end, revenue: summarizeIncome(tasks), jobCount: transportJobs(tasks).length,
    payeeType: identity.type, payeeConflict: identity.conflict,
    tasks: [...tasks].sort((a, b) => a.workDate.localeCompare(b.workDate) || Number(a.id) - Number(b.id)).map(task => ({ id: task.id!, date: task.workDate,
      work: driverTaskLabel(task), reference: task.reference, from: task.fromLocation, to: task.toLocation, miles: task.miles,
      file: task.fileName || "", sheet: task.sheetName, row: task.sourceRow, payeeType: taskPayeeType(task), income: task.income ? structuredClone(task.income) : undefined, rawCells: { ...task.rawCells } })) };
}
export type SettlementPayment = { id: string; amount: number; date: string; reference: string; note: string; voided: boolean; voidReason: string | null };
export type WeeklySettlement = SettlementInput & {
  id: string; weekEnd: string; status: "draft" | "confirmed"; totalAmount: number; paidAmount: number;
  snapshot: SettlementSnapshot; payments: SettlementPayment[]; confirmedAt: string | null; updatedAt: string;
  audit: Array<{ event: string; at: string; details: Record<string, unknown> }>;
};
export function paymentBalance(total: number, payments: Pick<SettlementPayment, "amount" | "voided">[]) {
  const paid = payments.filter(payment => !payment.voided).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  return { paidAmount: paid / 100, remaining: (Math.round(total * 100) - paid) / 100 };
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
