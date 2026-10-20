import type { DriverDay, DriverTask } from "./oak-driver-types";

export type IncomeRule = {
  id: number; name: string; workLabel: string; fromLocation: string | null; toLocation: string | null;
  amount: number; billingBasis: "segment" | "trip"; validFrom: string | null; validTo: string | null; active: boolean;
};
export type IncomeRuleInput = Omit<IncomeRule, "id">;
export type IncomeReview = {
  taskId: string; mode: "label" | "manual" | "included"; workLabel: string | null;
  amount: number | null; includedTaskId: string | null; note: string;
};
export type TaskIncome = {
  status: "priced" | "pending" | "conflict" | "included"; workLabel: string | null; amount: number | null;
  basis: string; source: "rule" | "manual" | "included" | null; ruleId: number | null;
  billingBasis: "segment" | "trip" | null; includedTaskId: string | null; review: IncomeReview | null;
};
export type IncomeSummary = { amount: number; pricedCount: number; pendingCount: number; includedCount: number };
export const emptyIncomeSummary = (): IncomeSummary => ({ amount: 0, pricedCount: 0, pendingCount: 0, includedCount: 0 });
export const normalizeIncomeText = (value: string | null | undefined) => (value || "").normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
export function normalizeIncomeWork(value: string | null | undefined) {
  const label = normalizeIncomeText(value);
  // Only the bare warehouse code and its direct-delivery label are equivalent.
  return label.match(/^([A-Z]{2,4}\d{1,2})(?:直送)?$/)?.[1] || label;
}

export function incomeWorkLabel(task: DriverTask) {
  if (task.nature?.trim() && !/^[-/]+$/.test(task.nature.trim())) return task.nature.trim();
  const reference = task.reference?.trim() || "";
  return /^(空车|带车架|挪柜|EMPTY)$/i.test(reference) ? reference : null;
}

export function incomeAmount(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(String(value))) throw new Error("收入金额需为非负数，最多两位小数");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > 9999999999.99) throw new Error("收入金额超出范围");
  return amount;
}

function optionalDate(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("生效日期无效");
  return value;
}
export function incomeText(value: unknown, max: number, required = false) {
  if (value != null && typeof value !== "string") throw new Error("文本格式无效");
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > max) throw new Error(required && !text ? "请填写必填内容" : `内容不能超过 ${max} 字符`);
  return text || null;
}
export function validateIncomeRule(value: unknown): IncomeRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("收入标准格式无效");
  const body = value as Record<string, unknown>;
  if (body.billingBasis !== "segment" && body.billingBasis !== "trip") throw new Error("请选择单段或整趟计价");
  if (typeof body.active !== "boolean") throw new Error("启用状态无效");
  const validFrom = optionalDate(body.validFrom); const validTo = optionalDate(body.validTo);
  if (validFrom && validTo && validFrom > validTo) throw new Error("生效开始日期不能晚于结束日期");
  return { name: incomeText(body.name, 120, true)!, workLabel: incomeText(body.workLabel, 120, true)!,
    fromLocation: incomeText(body.fromLocation, 100), toLocation: incomeText(body.toLocation, 100),
    amount: incomeAmount(body.amount), billingBasis: body.billingBasis, validFrom, validTo, active: body.active };
}

export function rulesOverlap(a: IncomeRuleInput, b: IncomeRuleInput) {
  return a.active && b.active && normalizeIncomeWork(a.workLabel) === normalizeIncomeWork(b.workLabel)
    && normalizeIncomeText(a.fromLocation) === normalizeIncomeText(b.fromLocation) && normalizeIncomeText(a.toLocation) === normalizeIncomeText(b.toLocation)
    && (a.validFrom || "0000-01-01") <= (b.validTo || "9999-12-31") && (b.validFrom || "0000-01-01") <= (a.validTo || "9999-12-31");
}

export function summarizeIncome(tasks: DriverTask[]): IncomeSummary {
  const summary = emptyIncomeSummary(); let cents = 0;
  for (const task of tasks) {
    const income = task.income;
    if (income?.status === "priced") { cents += Math.round(income.amount! * 100); summary.pricedCount++; }
    else if (income?.status === "included") summary.includedCount++;
    else summary.pendingCount++;
  }
  return { ...summary, amount: cents / 100 };
}

export function priceDriverDays(days: DriverDay[], rules: IncomeRule[], reviews: IncomeReview[]): DriverDay[] {
  const byReview = new Map(reviews.map(review => [review.taskId, review]));
  const tasks = days.flatMap(day => day.tasks).map(task => {
    const review = task.id ? byReview.get(task.id) || null : null;
    const workLabel = review?.workLabel || incomeWorkLabel(task);
    const income: TaskIncome = { status: "pending", workLabel, amount: null, basis: "未找到适用的收入标准", source: null,
      ruleId: null, billingBasis: null, includedTaskId: review?.includedTaskId || null, review };
    if (review?.mode === "manual") {
      income.status = "priced"; income.amount = review.amount; income.source = "manual"; income.basis = `人工核定${review.note ? `：${review.note}` : ""}`;
    } else if (review?.mode === "included") {
      income.basis = "等待主作业收入确认";
    } else if (!workLabel) {
      income.basis = "原表未注明作业类型，需核对作业";
    } else {
      const matches = rules.filter(rule => rule.active && normalizeIncomeWork(rule.workLabel) === normalizeIncomeWork(workLabel)
        && (!rule.fromLocation || normalizeIncomeText(rule.fromLocation) === normalizeIncomeText(task.fromLocation))
        && (!rule.toLocation || normalizeIncomeText(rule.toLocation) === normalizeIncomeText(task.toLocation))
        && (!rule.validFrom || task.workDate >= rule.validFrom) && (!rule.validTo || task.workDate <= rule.validTo));
      const specificity = (rule: IncomeRule) => Number(Boolean(rule.fromLocation)) + Number(Boolean(rule.toLocation));
      const bestScore = Math.max(-1, ...matches.map(specificity));
      const best = matches.filter(rule => specificity(rule) === bestScore);
      if (best.length > 1) { income.status = "conflict"; income.basis = "多条同优先级收入标准匹配，需核对"; }
      else if (best.length === 1) {
        const rule = best[0];
        income.status = "priced"; income.amount = rule.amount; income.source = "rule"; income.ruleId = rule.id; income.billingBasis = rule.billingBasis;
        income.basis = `${rule.name} · $${rule.amount.toFixed(2)} / ${rule.billingBasis === "trip" ? "趟（含回程）" : "段"}`;
      }
    }
    return { ...task, income };
  });
  const byId = new Map(tasks.filter(task => task.id).map(task => [task.id!, task]));
  // A repeated trip label may describe several legs, not several billable trips.
  for (const task of tasks) {
    const income = task.income;
    if (income.source !== "rule" || income.billingBasis !== "trip") continue;
    const rule = rules.find(candidate => candidate.id === income.ruleId)!;
    const sameTripCandidates = tasks.filter(candidate => candidate.driverName === task.driverName && candidate.workDate === task.workDate && candidate.importId === task.importId
      && normalizeIncomeWork(candidate.income.workLabel) === normalizeIncomeWork(rule.workLabel)
      && (!rule.fromLocation || normalizeIncomeText(candidate.fromLocation) === normalizeIncomeText(rule.fromLocation))
      && (!rule.toLocation || normalizeIncomeText(candidate.toLocation) === normalizeIncomeText(rule.toLocation)));
    if (sameTripCandidates.length > 1) {
      income.status = "pending"; income.amount = null;
      income.basis = `${rule.name} · 同日多段匹配整趟标准，需核定主作业及回程归属`;
    }
  }
  for (const task of tasks) {
    if (task.income.review?.mode !== "included") continue;
    const anchor = byId.get(task.income.includedTaskId || "");
    if (!anchor || anchor === task || anchor.driverName !== task.driverName || anchor.importId !== task.importId
      || anchor.income.review?.mode === "included" || anchor.income.status !== "priced" || (anchor.income.source === "rule" && anchor.income.billingBasis !== "trip")) continue;
    task.income.status = "included"; task.income.amount = 0; task.income.source = "included";
    task.income.basis = `已含在 ${anchor.workDate} ${anchor.income.workLabel || "主作业"} 收入中 · ${anchor.reference || `原表第 ${anchor.sourceRow} 行`}`;
  }
  let offset = 0;
  return days.map(day => {
    const ratedTasks = tasks.slice(offset, offset + day.tasks.length); offset += day.tasks.length;
    return { ...day, tasks: ratedTasks, revenue: summarizeIncome(ratedTasks) };
  });
}
