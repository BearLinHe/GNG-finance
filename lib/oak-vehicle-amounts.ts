import { incomeAmount, incomeText, summarizeIncome } from "./oak-income";
import { applyOwnerVehicleCosts, calculateVehicleAccounting, vehicleRange, type VehicleAccountingReview, type VehicleAccountingRow, type VehicleField, type VehicleRange } from "./oak-vehicle-accounting";
import type { DriverTask } from "./oak-driver-types";
import type { ProfitSettlement } from "./oak-period-profit";
import { vehicleForSubject, type OakVehicle } from "./oak-vehicles";
import { taskPayeeType, type PayeeType } from "./oak-payee";
import type {RepairDetails,RepairFeedStatus} from './oak-repair';
import type { PayrollSource } from './oak-payroll';
import {incomeActivityGaps} from './oak-income-coverage';
import {allocateFuelAmount,type FuelAllocation,type FuelLedgerSummary,type FuelMileageContext,type FuelWorkMileage} from './oak-fuel';

export type VehicleAmountCategory = VehicleField | "other";
export type VehicleAmount = VehicleRange & {
  id: string; vehicleId: string; category: VehicleAmountCategory; amount: number; note: string;
  payeeType: PayeeType | null; version: number; requestKey: string; sourceReviewId: string | null; updatedAt: string;
  source?:'manual'|'repair';repair?:RepairDetails;payroll?:PayrollSource;
};
export type AllocatedVehicleAmount = VehicleAmount & { allocatedAmount: number|null; overlapDays: number; totalDays: number; pendingReason?:string };
export type VehicleAmountInput = Omit<VehicleAmount, "id" | "sourceReviewId" | "updatedAt"> & { id: string | null };
export type VehicleAmountsResponse = { vehicles: OakVehicle[]; records: Array<VehicleAmount & { allocation: ReturnType<typeof allocateVehicleAmount> | FuelAllocation | null; workMileage?:FuelWorkMileage|null }>;
  repairStatus?:RepairFeedStatus;
  totalCount:number;page:number;pageSize:number;totalAmount:number|null;hasRepairOverlap?:boolean;defaultRange:VehicleRange;fuelMileage?:Record<string,FuelMileageContext>;fuelSummary?:FuelLedgerSummary };
export const amountCategoryLabels:Record<VehicleAmountCategory,string>={maintenance:"维修费",labor:"司机工资",insurance:"车辆保险",income:"车辆收入",fuel:"油费",other:"其他费用"};
export const amountCategories = ["maintenance", "labor", "insurance", "income", "fuel", "other"] as const;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
export const periodDays = (range: VehicleRange) => day(range.dateTo) - day(range.dateFrom) + 1;
export const overlaps = (a: VehicleRange, b: VehicleRange) => a.dateFrom <= b.dateTo && a.dateTo >= b.dateFrom;
export function allocateVehicleAmount(record: VehicleRange & { amount: number }, range: VehicleRange) {
  const totalDays = periodDays(record);
  const from = Math.max(day(record.dateFrom), day(range.dateFrom));
  const to = Math.min(day(record.dateTo), day(range.dateTo));
  if (from > to) return { allocatedAmount: 0, overlapDays: 0, totalDays };
  const cents = Math.round(record.amount * 100); const offset = from - day(record.dateFrom);
  // Allocate prefix cents so adjacent periods always reconcile to the original amount.
  const allocated = Math.floor(cents * (to - day(record.dateFrom) + 1) / totalDays) - Math.floor(cents * offset / totalDays);
  return { allocatedAmount: allocated / 100, overlapDays: to - from + 1, totalDays };
}
export function validateVehicleAmount(value: unknown): VehicleAmountInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("明细内容无效");
  const body = value as Record<string, unknown>;
  if (!amountCategories.includes(body.category as VehicleAmountCategory)) throw new Error("费用或收入类型无效");
  if (body.id != null && (typeof body.id !== "string" || !/^[1-9]\d{0,14}$/.test(body.id))) throw new Error("明细编号无效");
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0 || (body.id != null && Number(body.version) < 1)) throw new Error("明细版本无效");
  if (typeof body.requestKey !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestKey)) throw new Error("请求编号无效");
  if (body.category === "labor" && body.payeeType !== "driver" && body.payeeType !== "owner") throw new Error("请选择司机工资或车主工资");
  return { ...vehicleRange(body), id: body.id == null ? null : String(body.id), vehicleId: incomeText(body.vehicleId, 60, true)!,
    category: body.category as VehicleAmountCategory, amount: incomeAmount(body.amount), note: incomeText(body.note, 1000) || "",
    payeeType: body.category === "labor" ? body.payeeType as PayeeType : null, version: Number(body.version), requestKey: body.requestKey };
}
function uncoveredAllocation(record: VehicleRange & { amount: number }, range: VehicleRange, manual: VehicleAmount[]) {
  let cents = 0;
  for (let date = Math.max(day(record.dateFrom), day(range.dateFrom)); date <= Math.min(day(record.dateTo), day(range.dateTo)); date++) {
    const workDate = new Date(date * 86400000).toISOString().slice(0, 10);
    if (!manual.some(item => item.dateFrom <= workDate && item.dateTo >= workDate)) cents += Math.round(allocateVehicleAmount(record, { dateFrom: workDate, dateTo: workDate }).allocatedAmount * 100);
  }
  return cents / 100;
}
export function calculateDatedVehicleAccounting(vehicle: OakVehicle, range: VehicleRange, tasks: DriverTask[], settlements: ProfitSettlement[], review: VehicleAccountingReview | null, sourceHash: string, records: VehicleAmount[],repairStatus?:RepairFeedStatus,incomeSources?:import('./oak-income-coverage').IncomeActivitySource[],fuelMileage?:FuelMileageContext): VehicleAccountingRow {
  const row = calculateVehicleAccounting(vehicle, range, tasks, settlements, null, sourceHash);
  const amounts:AllocatedVehicleAmount[] = records.filter(record => record.vehicleId === vehicle.id && overlaps(record, range)).map(record => ({ ...record, ...(record.category==='fuel'?allocateFuelAmount(record,range,fuelMileage):allocateVehicleAmount(record, range)) }));
  const entries = (category: VehicleAmountCategory) => amounts.filter(item => item.category === category);
  const sum = (category: VehicleAmountCategory) => entries(category).reduce((value, item) => value + Math.round((item.allocatedAmount??0) * 100), 0) / 100;
  const covered = (task: DriverTask, category: VehicleAmountCategory) => entries(category).some(item => task.workDate >= item.dateFrom && task.workDate <= item.dateTo);
  const remainingIncome = tasks.filter(task => !covered(task, "income"));
  const income = summarizeIncome(remainingIncome);
  row.autoIncome = tasks.length && !summarizeIncome(tasks).pendingCount ? summarizeIncome(tasks).amount : null;
  row.lines.income = { amount: !income.pendingCount && (tasks.length || entries("income").length) ? (Math.round(sum("income") * 100) + Math.round(income.amount * 100)) / 100 : null,
    source: entries("income").length ? "ledger" : row.autoIncome == null ? "missing" : "auto", basis: `${entries("income").length} 笔周期收入 · ${income.pendingCount} 段待计价` };
  if(incomeSources){const gaps=incomeActivityGaps(records.filter(record=>record.vehicleId===vehicle.id),incomeSources,range);if(gaps.length){
    row.lines.income.knownAmount=(Math.round(sum('income')*100)+Math.round(income.amount*100))/100;
    row.lines.income.amount=null;row.lines.income.pendingReason=`${gaps.length} 张工资周表尚未同步作业`;row.lines.income.basis+=` · ${row.lines.income.pendingReason}`;
  }}
  const manualLabor = entries("labor");
  const eligible = settlements.filter(item => item.status === "confirmed" && vehicleForSubject([vehicle],item.subject)?.id===vehicle.id && overlaps({ dateFrom: item.weekStart, dateTo: item.weekEnd }, range));
  const autoRoles=new Set(eligible.map(item=>item.payeeType));if(autoRoles.size===1)row.autoPayeeType=[...autoRoles][0];
  const payroll = eligible.map(item => {
    const gross = Math.round(item.baseAmount * 100) + item.adjustments.filter(adjustment => adjustment.kind === "allowance").reduce((value, adjustment) => value + Math.round(adjustment.amount * 100), 0);
    const dates={dateFrom:item.weekStart,dateTo:item.weekEnd};
    return { ...item, allocated: uncoveredAllocation({ ...dates, amount: gross / 100 }, range, manualLabor),
      allocatedDays:uncoveredAllocation({...dates,amount:periodDays(dates)},range,manualLabor) };
  });
  const uncoveredTasks=tasks.filter(task=>!covered(task,'labor')&&!eligible.some(item=>item.taskIds.includes(task.id!)));
  const missingLabor = uncoveredTasks.length>0;
  const roles = new Set<PayeeType>([...manualLabor.map(item => item.payeeType!), ...payroll.filter(item => item.allocatedDays > 0).map(item => item.payeeType),...uncoveredTasks.map(taskPayeeType)].filter((type):type is PayeeType=>Boolean(type)));
  const identityConflict = roles.size > 1;
  const knownLabor = payroll.reduce((value, item) => value + Math.round(item.allocated * 100), 0) / 100;
  const laborKnown = !missingLabor && !identityConflict && (payroll.length || manualLabor.length);
  // An entered subtotal is visible even when the full-period wage cost is still unknown.
  const enteredLabor=(Math.round(sum('labor')*100)+Math.round(knownLabor*100))/100;
  const missingWorkDates=[...new Set(uncoveredTasks.map(task=>task.workDate))].sort();
  const pendingReason=identityConflict?'司机工资和车主工资身份冲突':missingLabor?`${missingWorkDates.length} 个作业日未匹配工资`:'暂无工资明细';
  row.autoLabor = !tasks.some(task => !eligible.some(item => item.taskIds.includes(task.id!))) && eligible.length ? eligible.reduce((value, item) => value + Math.round(allocateVehicleAmount({ dateFrom: item.weekStart, dateTo: item.weekEnd, amount: (Math.round(item.baseAmount * 100) + item.adjustments.filter(a => a.kind === "allowance").reduce((s, a) => s + Math.round(a.amount * 100), 0)) / 100 }, range).allocatedAmount * 100), 0) / 100 : null;
  row.laborSources = payroll.map(item => ({ id: item.id, subject: item.subject, from: item.weekStart, to: item.weekEnd, amount: item.allocated }));
  row.payeeType = roles.size === 1 ? [...roles][0] : row.autoPayeeType;
  row.lines.labor = { amount: laborKnown ? enteredLabor : null,
    knownAmount:manualLabor.length||payroll.some(item=>item.allocatedDays>0)?enteredLabor:undefined,
    ...(!laborKnown?{pendingReason,missingWorkDates}:{}),
    source: manualLabor.length ? "ledger" : laborKnown ? "auto" : "missing", basis: `${manualLabor.length} 笔工资明细 · ${payroll.length} 笔周结算按天分摊${!laborKnown?` · ${pendingReason}`:''}` };
  for (const category of ["fuel", "maintenance", "insurance"] as const) row.lines[category] = {
    amount: entries(category).length ? sum(category) : null, source: entries(category).length ? "ledger" : "missing", basis: `${entries(category).length} 笔明细按重叠天数分摊`
  };
  const fuel=entries('fuel'),pendingFuel=fuel.filter(item=>item.allocatedAmount==null);
  if(fuel.length){
    const reason=[...new Set(pendingFuel.map(item=>item.pendingReason))].filter(Boolean).join('；');
    row.lines.fuel={amount:pendingFuel.length?null:sum('fuel'),source:'ledger',basis:`${fuel.length} 笔油费 · 按作业里程分摊${reason?` · ${reason}`:''}`,
      ...(pendingFuel.length?{pendingReason:reason,...(fuel.some(item=>item.allocatedAmount!=null)?{knownAmount:sum('fuel')}: {})}: {})};
  }
  if(repairStatus){
    const manual=entries('maintenance').filter(item=>item.source!=='repair');const source=entries('maintenance').filter(item=>item.source==='repair');
    const conflict=manual.some(item=>item.sourceReviewId!=null&&source.some(invoice=>overlaps(item,invoice)));
    const known=repairStatus.available&&(repairStatus.matchedVehicleIds.includes(vehicle.id)||manual.length>0)&&!source.some(item=>item.repair?.dateBasis!=='completed')&&!conflict&&!repairStatus.reviewVehicleIds?.includes(vehicle.id);
    row.lines.maintenance={amount:known?[...manual,...source].reduce((sum,item)=>sum+Math.round((item.allocatedAmount??0)*100),0)/100:null,source:known?'ledger':'missing',basis:!repairStatus.available?repairStatus.message:conflict?'人工维修总额与维修库账单周期重叠，待核对':!repairStatus.matchedVehicleIds.includes(vehicle.id)&&!manual.length?'维修库未匹配此车号':`${source.length} 笔维修库账单 · ${manual.length} 笔人工明细`};
  }
  applyOwnerVehicleCosts(row.lines,roles.size===1&&roles.has('owner')&&!uncoveredTasks.some(task=>!taskPayeeType(task)));
  row.otherAmount = sum("other"); row.amounts = amounts; row.review = review; row.stale = false;
  row.issues = Object.entries(row.lines).filter(([, line]) => line.amount == null).map(([key]) => `${key === "income" ? "车辆收入" : key === "labor" ? "工资" : key === "fuel" ? "油费" : key === "insurance" ? "保险" : "维修费"}待核对`);
  if (identityConflict) row.issues.push("司机工资和车主工资身份冲突");
  if (!vehicle.vehicleNumber) row.issues.push("车号待补充");
  row.totalCost = [row.lines.labor, row.lines.fuel, row.lines.maintenance, row.lines.insurance].every(line => line.amount != null) ?
    [row.lines.labor.amount!, row.lines.fuel.amount!, row.lines.maintenance.amount!, row.lines.insurance.amount!, row.otherAmount].reduce((value, amount) => value + Math.round(amount * 100), 0) / 100 : null;
  row.net = !row.issues.length && row.totalCost != null ? (Math.round(row.lines.income.amount! * 100) - Math.round(row.totalCost * 100)) / 100 : null;
  row.status = row.net == null ? "pending" : row.net > 0 ? "profit" : row.net < 0 ? "loss" : "even";
  return row;
}
