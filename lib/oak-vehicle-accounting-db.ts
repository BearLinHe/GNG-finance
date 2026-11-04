import { createHash } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import { ensureSystemSchema, withSystemClient } from "./system-db";
import { IncomeInputError, incomeRulesQuery, readRatedDriverTasks } from "./oak-income-db";
import { incomeText } from "./oak-income";
import type { DriverTask } from "./oak-driver-types";
import { profitTaskSignature, type ProfitSettlement } from "./oak-period-profit";
import { validateVehicleAccounting, vehicleRange, vehicleFields,
  type VehicleAccountingResponse, type VehicleAccountingReview, type VehicleRange } from "./oak-vehicle-accounting";
import { assertUniqueVehicleLinks, vehicleForSubject, type OakVehicle } from "./oak-vehicles";
import { resolveDriverBatchPeriod } from "./oak-driver-batch";
import { readOakVehicles as readVehicles } from "./oak-vehicles-db";
import { readVehicleAmounts } from "./oak-vehicle-amounts-db";
import { calculateDatedVehicleAccounting, type VehicleAmount, type VehicleAmountCategory } from "./oak-vehicle-amounts";
import {readRepairFeed} from './oak-repair-db';
import {incomeActivityGaps} from './oak-income-coverage';

function reviewFromRow(row: Record<string, unknown>): VehicleAccountingReview {
  return { vehicleId: String(row.vehicle_id), dateFrom: String(row.date_from), dateTo: String(row.date_to),
    entries: row.entries as VehicleAccountingReview["entries"], otherExpenses: row.other_expenses as VehicleAccountingReview["otherExpenses"],
    payeeType: row.payee_type as VehicleAccountingReview["payeeType"], note: String(row.note), sourceHash: String(row.source_hash),
    version: Number(row.version), updatedAt: String(row.updated_at) };
}
type AccountingQuery = { range?: VehicleRange; vehicleId?: string; ranges?: Record<string, VehicleRange> };
async function readAccounting(client: PoolClient, query: AccountingQuery, freshRepair = false) {
  const vehicles = await readVehicles(client);
  if (query.vehicleId && !vehicles.some(vehicle => vehicle.id === query.vehicleId)) throw new IncomeInputError("车辆不存在");
  const repairPromise = readRepairFeed(vehicles, freshRepair);
  // These parameter-free reads share the same transaction snapshot and network round trip.
  const [reviewResult, importResult, subjectResult, ruleResult] = await client.query(`
    select a.*,a.date_from::text,a.date_to::text,a.updated_at::text from oak_vehicle_accounting a order by a.updated_at desc,a.id desc;
    select i.file_name,i.file_hash,i.period_from::text,i.period_to::text,min(t.work_date)::text as first_date,jsonb_agg(distinct t.sheet_name) as sheet_names
      from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id group by i.id;
    select driver_name as name,count(*)::int as "taskCount" from oak_driver_tasks group by driver_name order by driver_name;
    ${incomeRulesQuery}
  `) as unknown as [QueryResult, QueryResult, QueryResult, QueryResult];
  const allReviews = reviewResult.rows.map(reviewFromRow);
  const imports = importResult.rows;
  const latest = imports.map(item => item.period_from && item.period_to ? { from: item.period_from, to: item.period_to } :
    resolveDriverBatchPeriod(item.file_name, item.first_date)).sort((a, b) => b.to.localeCompare(a.to))[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const fallback = query.range ? { dateFrom: query.range.dateFrom, dateTo: query.range.dateTo } : { dateFrom: latest?.from || today, dateTo: latest?.to || today };
  const selected = vehicles.filter(vehicle => !query.vehicleId || query.vehicleId === vehicle.id);
  const ranges = new Map(selected.map(vehicle => {
    const previous = allReviews.find(review => review.vehicleId === vehicle.id);
    return [vehicle.id, query.ranges?.[vehicle.id] || (query.range ? fallback : previous ? { dateFrom: previous.dateFrom, dateTo: previous.dateTo } : fallback)];
  }));
  const from = [...ranges.values()].map(range => range.dateFrom).sort()[0];
  const to = [...ranges.values()].map(range => range.dateTo).sort().at(-1)!;
  const vehicleIds = new Map<string, string | null>();
  const vehicleIdFor = (name: string) => {
    if (!vehicleIds.has(name)) vehicleIds.set(name, vehicleForSubject(vehicles, name)?.id || null);
    return vehicleIds.get(name)!;
  };
  const subjects = subjectResult.rows.map(row => ({ ...row, vehicleId: vehicleIdFor(row.name) })) as VehicleAccountingResponse["subjects"];
  const rated=await readRatedDriverTasks(client,{dateFrom:from,dateTo:to},ruleResult.rows);
  const settlements = (await client.query(`select s.id::text,s.subject,s.week_start::text as "weekStart",s.week_end::text as "weekEnd",
    s.payee_type as "payeeType",s.base_amount::float8 as "baseAmount",s.adjustments,s.status,
    coalesce((select jsonb_agg(st.task_id::text order by st.task_id) from oak_settlement_tasks st where st.settlement_id=s.id),'[]') as "taskIds"
    from oak_weekly_settlements s where s.status='confirmed' and s.week_start<=$2::date and s.week_end>=$1::date`, [from, to])).rows as ProfitSettlement[];
  const taskRows = new Map<string, DriverTask[]>();
  const repairFeed=await repairPromise;
  const amountRows = [...await readVehicleAmounts(client, {dateFrom:from,dateTo:to}),...repairFeed.records.filter(item=>item.dateFrom<=to&&item.dateTo>=from)];
  const rows = selected.map(vehicle => {
    const range = ranges.get(vehicle.id)!;
    const scoped = rated.filter(task => task.workDate >= range.dateFrom && task.workDate <= range.dateTo && vehicleIdFor(task.driverName) === vehicle.id);
    taskRows.set(vehicle.id, scoped);
    const vehicleAmounts = amountRows.filter(item=>item.vehicleId===vehicle.id && item.dateFrom<=range.dateTo && item.dateTo>=range.dateFrom);
    const vehicleSettlements = settlements.filter(item=>vehicleIdFor(item.subject)===vehicle.id);
    const sourceHash = createHash("sha256").update(JSON.stringify([vehicle, range, profitTaskSignature(scoped),
      scoped.map(task => [task.id, task.income]), vehicleSettlements, vehicleAmounts,incomeActivityGaps(vehicleAmounts,imports.map(item=>({fileHash:item.file_hash,sheetNames:item.sheet_names})),range)])).digest("hex");
    const review = allReviews.find(item => item.vehicleId === vehicle.id && item.dateFrom === range.dateFrom && item.dateTo === range.dateTo) || null;
    const row = calculateDatedVehicleAccounting(vehicle, range, scoped, vehicleSettlements, review, sourceHash, vehicleAmounts,repairFeed.status,imports.map(item=>({fileHash:item.file_hash,sheetNames:item.sheet_names})));
    row.history = allReviews.filter(item => item.vehicleId === vehicle.id).map(item => ({ dateFrom: item.dateFrom, dateTo: item.dateTo }));
    return row;
  });
  const complete = rows.filter(row => row.net != null);
  const payload: VehicleAccountingResponse = { ...fallback, rows, vehicles, subjects,repairStatus:repairFeed.status,
    summary: { complete: complete.length, pending: rows.length - complete.length,
      income: complete.reduce((sum, row) => sum + Math.round(row.lines.income.amount! * 100), 0) / 100,
      cost: complete.reduce((sum, row) => sum + Math.round(row.totalCost! * 100), 0) / 100,
      net: complete.reduce((sum, row) => sum + Math.round(row.net! * 100), 0) / 100 } };
  return { payload, taskRows, amountRows };
}
async function writeInlineAmount(client:PoolClient,reviewId:string,category:VehicleAmountCategory,amount:number|null,scope:{vehicleId:string;dateFrom:string;dateTo:string;payeeType:string;note:string},records:VehicleAmount[]) {
  const existing=records.filter(item=>item.vehicleId===scope.vehicleId && item.category===category && item.dateFrom<=scope.dateTo && item.dateTo>=scope.dateFrom);
  if(existing.some(item=>item.source==='repair'))throw new IncomeInputError('维修库账单只读，请在维修库修改；额外费用可在维修明细中新增');
  if(existing.length>1 || existing.some(item=>item.dateFrom!==scope.dateFrom || item.dateTo!==scope.dateTo)) throw new IncomeInputError("该金额包含多笔或跨周期明细，请进入对应费用明细修改");
  if(amount==null){
    if(existing[0]) await client.query("update oak_vehicle_amounts set voided_at=now(),version=version+1,updated_at=now() where id=$1",[existing[0].id]);
    return;
  }
  if(existing[0]){
    await client.query("update oak_vehicle_amounts set amount=$2,payee_type=$3,version=version+1,updated_at=now() where id=$1",[existing[0].id,amount,category==='labor'?scope.payeeType:null]);return;
  }
  await client.query(`insert into oak_vehicle_amounts(vehicle_id,category,date_from,date_to,amount,payee_type,note,request_key,source_review_id,source_field)
    values($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$2) on conflict(request_key) do update set amount=excluded.amount,payee_type=excluded.payee_type,
    voided_at=null,version=oak_vehicle_amounts.version+1,updated_at=now()`,[scope.vehicleId,category,scope.dateFrom,scope.dateTo,amount,category==='labor'?scope.payeeType:null,scope.note,`review-${reviewId}-${category}`,reviewId]);
}
export async function listVehicleAccounting(params: URLSearchParams) {
  let query: AccountingQuery;
  try {
    query = { vehicleId: params.get("vehicleId") || undefined };
    if (params.get("dateFrom") || params.get("dateTo")) query.range = vehicleRange(Object.fromEntries(params));
    if (params.has("ranges")) {
      const raw = params.get("ranges")!;
      if (raw.length > 10000) throw new Error("核算周期内容过长");
      const ranges = JSON.parse(raw);
      if (!ranges || typeof ranges !== "object" || Array.isArray(ranges) || Object.keys(ranges).length > 60) throw new Error("核算周期无效");
      query.ranges = Object.fromEntries(Object.entries(ranges).map(([id, range]) => [id, vehicleRange(range as Record<string, unknown>)]));
    }
  } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin isolation level repeatable read");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      const result = await readAccounting(client, query);
      await client.query("commit");
      return params.get("detail") === "1" && query.vehicleId ? { ...result.payload, tasks: result.taskRows.get(query.vehicleId) } : result.payload;
    } catch (e) { await client.query("rollback"); throw e; }
  });
}
export async function saveVehicleAccounting(value: unknown) {
  let input;
  try { input = validateVehicleAccounting(value); } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      // Serialize with source deletion, grouping/reviews, and income-rule changes.
      for (const lock of [1, 2, 3]) await client.query("select pg_advisory_xact_lock(19431,$1)", [lock]);
      const { payload, taskRows, amountRows } = await readAccounting(client, { vehicleId: input.vehicleId, range: input }, true);
      const row = payload.rows[0];
      if (row.sourceHash !== input.sourceHash) throw new IncomeInputError("自动数据或车辆关联已变化，请重新读取后核对");
      if (input.changedFields?.some(field=>row.lines[field].notApplicable)) throw new IncomeInputError('车主车辆不计保险和维修费，无需填写这两项');
      if (input.entries.labor.mode === "auto" && input.payeeType !== row.autoPayeeType) throw new IncomeInputError("自动报酬类型与周结算不一致，请选择人工核定后填写");
      const current = await client.query(`select id,version from oak_vehicle_accounting where vehicle_id=$1 and date_from=$2::date and date_to=$3::date for update`, [input.vehicleId, input.dateFrom, input.dateTo]);
      if (Number(current.rows[0]?.version || 0) !== input.version) throw new IncomeInputError("该周期已被其他操作修改，请重新读取");
      const saved = await client.query(`insert into oak_vehicle_accounting(vehicle_id,date_from,date_to,payee_type,entries,other_expenses,note,source_hash,task_ids,amounts_migrated)
        values($1,$2::date,$3::date,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,true)
        on conflict(vehicle_id,date_from,date_to) do update set payee_type=excluded.payee_type,entries=excluded.entries,
        other_expenses=excluded.other_expenses,note=excluded.note,source_hash=excluded.source_hash,task_ids=excluded.task_ids,
        version=oak_vehicle_accounting.version+1,updated_at=now() returning id::text,version`,
      [input.vehicleId, input.dateFrom, input.dateTo, input.payeeType, JSON.stringify(input.entries), JSON.stringify(input.otherExpenses),
        input.note, input.sourceHash, JSON.stringify(taskRows.get(input.vehicleId)!.map(task => task.id))]);
      for(const field of (input.changedFields || vehicleFields).filter(field=>!row.lines[field].notApplicable)) await writeInlineAmount(client,saved.rows[0].id,field,input.entries[field].mode==='manual'?input.entries[field].amount:null,input,amountRows);
      if(input.otherChanged!==false) await writeInlineAmount(client,saved.rows[0].id,'other',input.otherExpenses.length?input.otherExpenses.reduce((sum,item)=>sum+Math.round(item.amount*100),0)/100:null,input,amountRows);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_accounting',$1,'保存单车周期核算',$2::jsonb)`, [saved.rows[0].id, JSON.stringify(input)]);
      await client.query("commit"); return { success: true, version: Number(saved.rows[0].version) };
    } catch (e) { await client.query("rollback"); throw e; }
  });
}
export async function updateOakVehicle(value: unknown) {
  let input: OakVehicle;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("车辆内容无效");
    const body = value as Record<string, unknown>;
    if (!Array.isArray(body.aliases) || body.aliases.length > 40) throw new Error("源表关联最多 40 项");
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new Error("车辆版本无效");
    input = { id: incomeText(body.id, 60, true)!, vehicleNumber: incomeText(body.vehicleNumber, 30), driverName: incomeText(body.driverName, 120, true)!,
      aliases: body.aliases.map(alias => incomeText(alias, 120, true)!), version: Number(body.version) };
  } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      await client.query("select pg_advisory_xact_lock(19431,3)");
      const vehicles = await readVehicles(client);
      const current = vehicles.find(vehicle => vehicle.id === input.id);
      if (!current || current.version !== input.version) throw new IncomeInputError("车辆资料已变化，请刷新");
      try { assertUniqueVehicleLinks(vehicles.map(vehicle => vehicle.id === input.id ? input : vehicle)); }
      catch (e) { throw new IncomeInputError((e as Error).message); }
      await client.query(`update oak_vehicles set vehicle_number=$2,driver_name=$3,aliases=$4::jsonb,version=version+1,updated_at=now() where id=$1`, [input.id, input.vehicleNumber, input.driverName, JSON.stringify(input.aliases)]);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle',0,'更新车辆及源表关联',$1::jsonb)`, [JSON.stringify({ before: current, after: input })]);
      await client.query("commit"); return { success: true };
    } catch (e) { await client.query("rollback"); throw e; }
  });
}
export async function deleteVehicleAccounting(value: unknown) {
  let scope: VehicleRange & { vehicleId: string; version: number };
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("核算范围无效");
    const body = value as Record<string, unknown>;
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new Error("核算版本无效");
    scope = { ...vehicleRange(body), vehicleId: incomeText(body.vehicleId, 60, true)!, version: Number(body.version) };
  } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      await client.query("select pg_advisory_xact_lock(19431,3)");
      await client.query(`update oak_vehicle_amounts set voided_at=now(),version=version+1,updated_at=now() where source_review_id in
        (select id from oak_vehicle_accounting where vehicle_id=$1 and date_from=$2::date and date_to=$3::date and version=$4) and voided_at is null`,[scope.vehicleId,scope.dateFrom,scope.dateTo,scope.version]);
      const result = await client.query(`delete from oak_vehicle_accounting where vehicle_id=$1 and date_from=$2::date and date_to=$3::date and version=$4 returning id::text`, [scope.vehicleId, scope.dateFrom, scope.dateTo, scope.version]);
      if (!result.rowCount) throw new IncomeInputError("核算已变化，请刷新后重试");
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_accounting',$1,'撤销单车周期核算',$2::jsonb)`, [result.rows[0].id, JSON.stringify(scope)]);
      await client.query("commit"); return { success: true };
    } catch (e) { await client.query("rollback"); throw e; }
  });
}
