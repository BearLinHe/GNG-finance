import type { DriverTask } from './oak-driver-types';
import { allocateFuelAmount, type FuelMileageContext } from './oak-fuel';
import { summarizeIncome } from './oak-income';
import { incomeActivityGaps, type IncomeActivitySource } from './oak-income-coverage';
import { taskPayeeType } from './oak-payee';
import type { ProfitSettlement } from './oak-period-profit';
import { allocateVehicleAmount, maintenanceReviewIssue, type VehicleAmount } from './oak-vehicle-amounts';
import type { RepairFeedStatus } from './oak-repair';
import type { VehicleRange } from './oak-vehicle-accounting';
import { oakVehicleSeeds, vehicleSubjectKey, type OakVehicle } from './oak-vehicles';
import { workflowDate } from './oak-workflow';

export const davidDriverKey = 'davidgao';
export const davidTrialRange = { dateFrom: '2026-08-01', dateTo: '2026-10-25' };
export type DriverUse = { dateFrom: string | null; dateTo: string | null; vehicleId: string };
export type DriverTimeline = { driverKey: string; version: number; uses: DriverUse[] };
export type DriverChoice = { key: string; name: string };
export type DriverUsePeriod = VehicleRange & { vehicleId: string | null; shared?: boolean };
type Source = VehicleRange & { amount: number; label: string; vehicleId?: string };
type Line = { amount: number | null; subtotal: number | null; pending: string[]; sources: Source[] };
export type DriverProfit = { income: Line; labor: Line; fuel: Line; insurance: Line; maintenance: Line; net: number | null; periods: DriverUsePeriod[] };
export type DriverAccountingResponse = { drivers: DriverChoice[]; vehicles: Pick<OakVehicle, 'id' | 'vehicleNumber'>[]; timeline: DriverTimeline; profit: DriverProfit };

export function driverDirectory(vehicles: OakVehicle[], names: string[]) {
  const aliases = new Map<string, Set<string>>();
  const profiles = new Map<string, DriverChoice>();
  const subjectKey = (name: string) => {
    const key = vehicleSubjectKey(name);
    return key === 'david高' ? davidDriverKey : key;
  };
  for (const vehicle of [...oakVehicleSeeds, ...vehicles]) {
    const key = subjectKey(vehicle.driverName);
    if (!profiles.has(key)) profiles.set(key, { key, name: vehicle.driverName });
    for (const name of [vehicle.driverName, ...vehicle.aliases]) {
      const alias = subjectKey(name);
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias)!.add(key);
    }
  }
  const keyFor = (name: string) => {
    const key = subjectKey(name);
    if (!key || /^\d+$/.test(key)) return null;
    const candidates = aliases.get(key);
    if (!candidates) return key;
    return candidates.size === 1 ? [...candidates][0] : profiles.has(key) ? key : null;
  };
  for (const name of names) {
    const key = keyFor(name);
    if (key && !profiles.has(key)) profiles.set(key, { key, name });
  }
  return { keyFor, drivers: [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) };
}

export function davidTimeline(vehicles: OakVehicle[]): DriverTimeline {
  const dates = [davidTrialRange.dateFrom, '2026-09-01', '2026-10-20'];
  const ends = ['2026-08-31', '2026-10-19', null];
  return { driverKey: davidDriverKey, version: 0, uses: ['2109', '77', '3033'].flatMap((number, index) => {
    const vehicle = vehicles.find(item => item.vehicleNumber === number);
    return vehicle ? [{ dateFrom: dates[index], dateTo: ends[index], vehicleId: vehicle.id }] : [];
  }) };
}

export function effectiveDriverTimelines(saved: DriverTimeline[], vehicles: OakVehicle[]): DriverTimeline[] {
  const timelines = [...saved];
  if (!saved.some(t => t.driverKey === davidDriverKey)) timelines.push(davidTimeline(vehicles));
  // Confirmed fixed assignment; do not infer historical use from other current roster names.
  const truck = vehicles.find(v => v.vehicleNumber === '877');
  if (truck && !saved.some(t => t.driverKey === '张晓澄')) {
    timelines.push({ driverKey: '张晓澄', version: 0, uses: [{ vehicleId: truck.id, dateFrom: null, dateTo: null }] });
  }
  return timelines;
}

const nextDay = (date: string) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
const overlap = (a: VehicleRange, b: VehicleRange): VehicleRange | null => {
  const dateFrom = a.dateFrom > b.dateFrom ? a.dateFrom : b.dateFrom;
  const dateTo = a.dateTo < b.dateTo ? a.dateTo : b.dateTo;
  return dateTo >= dateFrom ? { dateFrom, dateTo } : null;
};
const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100;
const inRange = (date: string, range: VehicleRange) => date >= range.dateFrom && date <= range.dateTo;
const contains = (outer: VehicleRange, inner: VehicleRange) => inRange(inner.dateFrom, outer) && inRange(inner.dateTo, outer);
const useRange = (use: DriverUse): VehicleRange => ({ dateFrom: use.dateFrom ?? '0001-01-01', dateTo: use.dateTo ?? '9999-12-31' });

export function validateDriverUses(value: unknown, vehicles: OakVehicle[]): DriverUse[] {
  if (!Array.isArray(value) || value.length > 60) throw new Error('最多保存 60 条用车记录');
  const uses = value.map(use => {
    if (!use || typeof use !== 'object' || typeof use.vehicleId !== 'string' || !vehicles.some(item => item.vehicleNumber && item.id === use.vehicleId)) throw new Error('请选择有效车号');
    const dateFrom = use.dateFrom === null ? null : workflowDate(use.dateFrom);
    const dateTo = use.dateTo === null ? null : workflowDate(use.dateTo);
    if (dateFrom !== null && dateTo !== null && dateTo < dateFrom) throw new Error('结束日期不能早于开始日期');
    return { dateFrom, dateTo, vehicleId: use.vehicleId as string };
  }).sort((a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? ''));
  if (uses.some((use, i) => i && overlap(useRange(use), useRange(uses[i - 1])))) throw new Error('同一司机的用车日期不能重叠，换车前请先填写上一辆车的结束日期');
  return uses;
}

export function hasSharedUse(uses: DriverUse[], other: DriverUse[]) {
  return uses.some(use => other.some(item => item.vehicleId === use.vehicleId && overlap(useRange(use), useRange(item))));
}

function vehicleOwners(vehicleId: string, range: VehicleRange, timelines: DriverTimeline[]) {
  const entries = timelines.flatMap(timeline => timeline.uses.flatMap(use => {
    const days = use.vehicleId === vehicleId && overlap(useRange(use), range);
    return days ? [{ driverKey: timeline.driverKey, ...days }] : [];
  }));
  return entries.sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

function covers(ranges: VehicleRange[], window: VehicleRange) {
  let cursor = window.dateFrom;
  for (const range of [...ranges].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))) {
    if (range.dateFrom > cursor) break;
    if (range.dateTo >= window.dateTo) return true;
    if (range.dateTo >= cursor) cursor = nextDay(range.dateTo);
  }
  return false;
}

function usePeriods(timeline: DriverTimeline, range: VehicleRange, timelines: DriverTimeline[]): DriverUsePeriod[] {
  const assigned = timeline.uses.flatMap(use => {
    const dates = overlap(useRange(use), range);
    return dates ? [{ ...dates, vehicleId: use.vehicleId, shared: vehicleOwners(use.vehicleId, dates, timelines).some(owner => owner.driverKey !== timeline.driverKey) }] : [];
  }).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const periods: DriverUsePeriod[] = [];
  let cursor = range.dateFrom;
  const dayBefore = (date: string) => new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  for (const period of assigned) {
    if (cursor < period.dateFrom) periods.push({ vehicleId: null, dateFrom: cursor, dateTo: dayBefore(period.dateFrom) });
    periods.push(period);
    if (period.dateTo === range.dateTo) return periods;
    cursor = nextDay(period.dateTo);
  }
  periods.push({ vehicleId: null, dateFrom: cursor, dateTo: range.dateTo });
  return periods;
}

const line = (sources: Source[], pending: string[], hasZero = false): Line => {
  const subtotal = sources.length || hasZero ? sum(sources.map(source => source.amount)) : null;
  return { amount: pending.length ? null : subtotal, subtotal, pending: [...new Set(pending)], sources };
};

const trialWindow = { dateFrom: davidTrialRange.dateFrom, dateTo: '2026-10-31' };
const davidFuel = [
  { ...davidTrialRange, amount: 16023.88, label: '财务核对 · David 个人油费（不重复计入原 77 号车油费）' },
  { dateFrom: '2026-10-26', dateTo: '2026-10-31', amount: 2916.21, label: '财务核对 · 10/26 至 10/31 两笔油费' },
];
const davidInsurance = [
  { dateFrom: '2026-08-01', dateTo: '2026-08-31', amount: 1730.6675, number: '2109', label: '财务核对 · 8 月保险' },
  { dateFrom: '2026-09-01', dateTo: '2026-09-30', amount: 507.1139, number: '77', label: '财务核对 · 9 月保险' },
  { dateFrom: '2026-09-26', dateTo: '2026-10-19', amount: 507.1139 * 24 / 30, number: '77', label: '财务核对 · 10 月账期，77 号车 24/30 天' },
  { dateFrom: '2026-10-20', dateTo: '2026-10-25', amount: 2485.63 * 6 / 30, number: '3033', label: '财务核对 · 10 月账期，3033 号车 6/30 天' },
];

export function driverProfit(input: { range: VehicleRange; timeline: DriverTimeline; timelines: DriverTimeline[]; vehicles: OakVehicle[];
  tasks: DriverTask[]; amounts: VehicleAmount[]; sources: IncomeActivitySource[]; keyFor: (name: string) => string | null;
  repairStatus: RepairFeedStatus; settlements?: ProfitSettlement[]; mileage?: Record<string, FuelMileageContext> }): DriverProfit {
  const { range, timeline, timelines, vehicles, tasks, amounts, sources, keyFor, settlements = [], mileage = {} } = input;
  const belongs = (name: string) => keyFor(name) === timeline.driverKey;
  const work = tasks.filter(task => belongs(task.driverName) && inRange(task.workDate, range));
  const wages = amounts.filter(record => record.category === 'labor' && record.payroll && belongs(record.payroll.sheetName) && overlap(record, range));
  const gaps = incomeActivityGaps(wages, sources, range);
  const rated = summarizeIncome(work);
  const incomeIssues = [...(rated.pendingCount ? [`${rated.pendingCount} 段作业待计价`] : []), ...(gaps.length ? [`${gaps.length} 张工资周表的作业待同步`] : [])];
  if (!work.length && !incomeIssues.length) incomeIssues.push('区间内没有已导入的作业');
  const income = line(rated.pricedCount ? [{ ...range, amount: rated.amount, label: `${rated.pricedCount} 段已计价作业` }] : [], incomeIssues, !!work.length && !rated.pendingCount);
  const laborSources = wages.map(record => ({ ...overlap(record, range)!, label: `${record.payroll!.fileName} · ${record.payroll!.sheetName}`, amount: allocateVehicleAmount(record, range).allocatedAmount }));
  const laborCover: VehicleRange[] = [...wages];
  const confirmed = settlements.filter(item => item.status === 'confirmed' && belongs(item.subject) && overlap({ dateFrom: item.weekStart, dateTo: item.weekEnd }, range));
  for (const item of confirmed) {
    const dates = { dateFrom: item.weekStart, dateTo: item.weekEnd };
    if (wages.some(wage => overlap(wage, dates))) continue;
    const gross = sum([item.baseAmount, ...item.adjustments.filter(a => a.kind === 'allowance').map(a => a.amount)]);
    laborSources.push({ ...overlap(dates, range)!, label: `已确认周结算 #${item.id}`, amount: allocateVehicleAmount({ ...dates, amount: gross }, range).allocatedAmount });
    laborCover.push(dates);
  }
  const missingWages = new Set(work.filter(task => !laborCover.some(period => inRange(task.workDate, period))).map(task => task.workDate));
  const labor = line(laborSources, [...(!laborSources.length ? ['暂无可归属到该司机的工资'] : []), ...(missingWages.size ? [`${missingWages.size} 个作业日缺少司机工资`] : [])]);

  const periods = usePeriods(timeline, range, timelines);
  const fuelSources: Source[] = [], insuranceSources: Source[] = [];
  const fuelIssues: string[] = [], insuranceIssues: string[] = [];
  const trial = timeline.driverKey === davidDriverKey;
  if (trial) {
    for (const item of davidFuel) {
      if (contains(range, item)) fuelSources.push(item);
      else if (overlap(range, item)) fuelIssues.push(`${item.dateFrom} 至 ${item.dateTo} 只有财务总额，缺少可拆分的加油日期`);
    }
    for (const item of davidInsurance) {
      const selected = overlap(item, range);
      if (!selected) continue;
      const vehicleId = vehicles.find(vehicle => vehicle.vehicleNumber === item.number)?.id;
      const covered = periods.filter(period => period.vehicleId === vehicleId && !period.shared).flatMap(period => {
        const dates = overlap(period, selected);
        return dates ? [dates] : [];
      });
      if (!covers(covered, selected)) insuranceIssues.push(`${item.number} 号车的财务保险分摊与换车记录不一致`);
      for (const dates of covered) insuranceSources.push({ ...dates, vehicleId, label: item.label, amount: allocateVehicleAmount(item, dates).allocatedAmount });
    }
    if (overlap(range, { dateFrom: '2026-10-26', dateTo: '2026-10-31' })) insuranceIssues.push('10/26 至 10/31 的个人保险分摊未确认');
  }

  const roles = new Set([...wages.map(wage => wage.payeeType), ...work.map(taskPayeeType), ...confirmed.map(item => item.payeeType)].filter(Boolean));
  const owner = roles.size === 1 && roles.has('owner');
  let needsInsurance = false;
  for (const period of periods) {
    const windows = trial ? [overlap(period, { dateFrom: range.dateFrom, dateTo: '2026-07-31' }), overlap(period, { dateFrom: '2026-11-01', dateTo: range.dateTo })].filter((value): value is VehicleRange => !!value) : [period];
    for (const window of windows) {
      if (!period.vehicleId || period.shared) {
        const reason = period.shared ? '用车日期与另一位司机重叠' : '核算区间有日期未登记用车';
        fuelIssues.push(reason);
        if (!owner) insuranceIssues.push(reason);
        continue;
      }
      const vehicleId = period.vehicleId;
      const number = vehicles.find(vehicle => vehicle.id === vehicleId)?.vehicleNumber ?? vehicleId;
      const ledger = amounts.filter(record => record.vehicleId === vehicleId && overlap(record, window));
      const fuel = ledger.filter(record => record.category === 'fuel');
      if (!covers(fuel, window)) fuelIssues.push(`${number} 号车缺少该用车周期的油费明细`);
      for (const record of fuel) {
        const dates = overlap(record, window)!;
        const owners = vehicleOwners(vehicleId, record, timelines);
        const exclusive = owners.every(item => item.driverKey === timeline.driverKey);
        const complete = covers(owners, record) && !owners.some((item, index) => index > 0 && overlap(item, owners[index - 1]));
        const context: FuelMileageContext = { days: [], coverage: [], gaps: [] };
        for (const owner of owners) {
          const data = mileage[owner.driverKey];
          if (!data) continue;
          context.days.push(...data.days.filter(day => inRange(day.workDate, owner)));
          for (const span of data.coverage) {
            const coverage = overlap(span, owner);
            if (coverage) context.coverage.push(coverage);
          }
          for (const gap of data.gaps) {
            const span = overlap(gap, owner);
            if (span) context.gaps.push({ ...span, reason: gap.reason });
          }
        }
        const result = complete && (exclusive || !contains(dates, record)) ? allocateFuelAmount(record, dates, context) : null;
        if (result?.allocatedAmount == null) fuelIssues.push(`${number} 号车：${result?.pendingReason ?? '油费账期有未登记或重叠的用车日期'}`);
        else fuelSources.push({ ...dates, vehicleId, label: `油费明细 #${record.id}`, amount: result.allocatedAmount });
      }
      if (!owner) {
        needsInsurance = true;
        const insurance = ledger.filter(record => record.category === 'insurance');
        if (!covers(insurance, window)) insuranceIssues.push(`${number} 号车缺少该用车周期的保险明细`);
        for (const record of insurance) {
          const dates = overlap(record, window)!;
          insuranceSources.push({ ...dates, vehicleId, label: `保险明细 #${record.id}`, amount: allocateVehicleAmount(record, dates).allocatedAmount });
        }
      }
    }
  }
  if (roles.size > 1 && (!trial || !contains(trialWindow, range))) insuranceIssues.push('司机和车主身份混用，需要核对保险归属');
  const fuel = line(fuelSources, fuelIssues);
  const insurance = line(insuranceSources, insuranceIssues, owner && !needsInsurance);
  const repairSources: Source[] = [], repairIssues: string[] = [];
  if (!owner) {
    if (roles.size > 1) repairIssues.push('司机和车主身份混用，需要核对维修费归属');
    for (const period of periods) {
      if (!period.vehicleId || period.shared) {
        repairIssues.push(period.shared ? '用车日期与另一位司机重叠' : '核算区间有日期未登记用车');
        continue;
      }
      const number = vehicles.find(v => v.id === period.vehicleId)?.vehicleNumber ?? period.vehicleId;
      const rows = amounts.filter(r => r.category === 'maintenance' && r.vehicleId === period.vehicleId && overlap(r, period));
      const issue = maintenanceReviewIssue(input.repairStatus, period.vehicleId, rows);
      if (issue) { repairIssues.push(`${number} 号车：${issue}`); continue; }
      for (const r of rows) repairSources.push({ ...overlap(r, period)!, vehicleId: period.vehicleId,
        label: `${number} 号车 · ${r.source === 'repair' ? '维修单 ' + r.note : '人工维修明细 #' + r.id}`,
        amount: allocateVehicleAmount(r, period).allocatedAmount });
    }
  }
  const maintenance = line(repairSources, repairIssues, !repairIssues.length);
  const net = income.amount != null && labor.amount != null && fuel.amount != null && insurance.amount != null && maintenance.amount != null
    ? sum([income.amount, -labor.amount, -fuel.amount, -insurance.amount, -maintenance.amount]) : null;
  return { income, labor, fuel, insurance, maintenance, net, periods };
}
