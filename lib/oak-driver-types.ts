import { emptyIncomeSummary, type IncomeSummary, type TaskIncome } from "./oak-income";
import { payeeIdentity, type PayeeType } from "./oak-payee";

export type DriverTask = {
  id?: string;
  importId?: number;
  income?: TaskIncome;
  payeeType?: PayeeType | null;
  sheetName: string;
  section: string;
  sourceRow: number;
  driverName: string;
  workDate: string;
  reference: string | null;
  nature: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  miles: number | null;
  notes: string | null;
  rawCells: Record<string, string | number | null>;
  fileName?: string;
};

export type DriverSheetPreview = {
  payeeType?: PayeeType | null;
  sheetName: string;
  driverName: string;
  selected: boolean;
  taskCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  warnings: string[];
};

export type DriverWorkbookPreview = {
  fileName: string;
  fileHash: string;
  sheets: DriverSheetPreview[];
  tasks: DriverTask[];
  skippedSheets: Array<{ sheetName: string; reason: string }>;
  warnings: string[];
  batchPeriod: { from: string; to: string };
};

export type DriverDay = {
  revenue?: IncomeSummary;
  driverName: string;
  workDate: string;
  tasks: DriverTask[];
  taskCount: number;
  miles: number | null;
};

export type DriverPeriod = {
  revenue?: IncomeSummary;
  driverName: string;
  dateFrom: string;
  dateTo: string;
  dayCount: number;
  taskCount: number;
  miles: number | null;
  taskTypes: Array<{ label: string; count: number }>;
  days: DriverDay[];
};

export type DriverImport = {
  id: number;
  fileName: string;
  createdAt: string;
  taskCount: number;
  driverCount: number;
  dateFrom: string;
  dateTo: string;
  recordDateFrom: string;
  recordDateTo: string;
  hasOutOfPeriodRecords: boolean;
};

export type DriverActivitiesResponse = {
  subjects?: Array<{ name: string; payeeType: PayeeType | null; conflict: boolean }>;
  periods: DriverPeriod[];
  dateRange: { from: string | null; to: string | null };
  totalCount: number;
  page: number;
  pageSize: number;
  summary: { driverCount: number; dayCount: number; taskCount: number; miles: number | null; revenue?: IncomeSummary };
  drivers: string[];
  imports: DriverImport[];
};

export function driverSubjectLabel(name: string) {
  return payeeIdentity(name).label;
}

export function driverTaskLabel(task: DriverTask) {
  return task.income?.workLabel || task.nature || (task.reference && /空车|带车架|挪柜/.test(task.reference) ? task.reference : "运输");
}

export function summarizeDriverTasks(tasks: DriverTask[]): DriverDay[] {
  const days = new Map<string, DriverDay>();
  for (const task of tasks) {
    const key = JSON.stringify([task.driverName, task.workDate]);
    const day = days.get(key) || { driverName: task.driverName, workDate: task.workDate, tasks: [], taskCount: 0, miles: null };
    day.tasks.push(task);
    day.taskCount += 1;
    if (task.miles != null) day.miles = Math.round(((day.miles || 0) + task.miles) * 100) / 100;
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => b.workDate.localeCompare(a.workDate) || a.driverName.localeCompare(b.driverName, "zh-CN"));
}

export function summarizeDriverPeriods(days: DriverDay[]): DriverPeriod[] {
  const drivers = new Map<string, DriverPeriod>();
  for (const day of days) {
    const period = drivers.get(day.driverName) || {
      driverName: day.driverName, dateFrom: day.workDate, dateTo: day.workDate,
      dayCount: 0, taskCount: 0, miles: null, taskTypes: [], days: []
    };
    period.dateFrom = day.workDate < period.dateFrom ? day.workDate : period.dateFrom;
    period.dateTo = day.workDate > period.dateTo ? day.workDate : period.dateTo;
    period.dayCount += 1;
    period.taskCount += day.taskCount;
    if (day.miles != null) period.miles = Math.round(((period.miles || 0) + day.miles) * 100) / 100;
    period.days.push(day);
    if (day.revenue) {
      const revenue = period.revenue || emptyIncomeSummary();
      period.revenue = { amount: (Math.round(revenue.amount * 100) + Math.round(day.revenue.amount * 100)) / 100,
        pricedCount: revenue.pricedCount + day.revenue.pricedCount, pendingCount: revenue.pendingCount + day.revenue.pendingCount, includedCount: revenue.includedCount + day.revenue.includedCount };
    }
    for (const task of day.tasks) {
      const label = driverTaskLabel(task);
      const type = period.taskTypes.find(item => item.label === label);
      if (type) type.count += 1;
      else period.taskTypes.push({ label, count: 1 });
    }
    drivers.set(day.driverName, period);
  }
  return [...drivers.values()].sort((a, b) => a.driverName.localeCompare(b.driverName, "zh-CN")).map(period => ({
    ...period,
    days: [...period.days].sort((a, b) => a.workDate.localeCompare(b.workDate)),
    taskTypes: period.taskTypes.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
  }));
}
