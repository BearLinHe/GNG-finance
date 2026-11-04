import type { PoolClient } from "pg";
import { IncomeInputError } from "./oak-income-db";
import { ensureSystemSchema, withSystemClient } from "./system-db";
import { readOakVehicles } from "./oak-vehicles-db";
import { allocateVehicleAmount, amountCategories, validateVehicleAmount, type VehicleAmount, type VehicleAmountCategory } from "./oak-vehicle-amounts";
import { vehicleRange, type VehicleRange } from "./oak-vehicle-accounting";
import { resolveDriverBatchPeriod } from "./oak-driver-batch";
import {readRepairFeed} from './oak-repair-db';
import {readFuelMileage} from './oak-fuel-db';
import {allocateFuelAmount} from './oak-fuel';

const columns = `id::text,vehicle_id as "vehicleId",category,date_from::text as "dateFrom",date_to::text as "dateTo",amount::float8,payee_type as "payeeType",note,version,request_key as "requestKey",source_review_id::text as "sourceReviewId",updated_at::text as "updatedAt",payroll_source as payroll`;
export async function readVehicleAmounts(client: PoolClient, range?: VehicleRange): Promise<VehicleAmount[]> {
  return (await client.query(`select ${columns} from oak_vehicle_amounts where voided_at is null
    and ($1::date is null or date_from<=$2::date and date_to>=$1::date) order by date_from,id`, [range?.dateFrom || null, range?.dateTo || null])).rows;
}
export async function listVehicleAmounts(params: URLSearchParams) {
  let category: VehicleAmountCategory; let range: VehicleRange | undefined; let page: number;
  try {
    category = params.get("category") as VehicleAmountCategory;
    if (!amountCategories.includes(category)) throw new Error("明细类型无效");
    if (params.get("dateFrom") || params.get("dateTo")) range = vehicleRange(Object.fromEntries(params));
    page = Number(params.get("page") || 1); if (!Number.isSafeInteger(page) || page < 1) throw new Error("页码无效");
    if ((params.get("search") || "").length > 120) throw new Error("搜索内容过长");
  } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const vehicles = await readOakVehicles(client);
    const vehicleId = params.get("vehicleId") || "";
    if (vehicleId && !vehicles.some(vehicle => vehicle.id === vehicleId)) throw new IncomeInputError("车辆不存在");
    const search = (params.get("search") || "").trim().toLocaleLowerCase();
    const repairFeed=category==='maintenance'?await readRepairFeed(vehicles):null;
    const records = [...await readVehicleAmounts(client, range),...(repairFeed?.records||[])].filter(record => record.category === category && (!range||record.dateFrom<=range.dateTo&&record.dateTo>=range.dateFrom) && (!vehicleId || record.vehicleId === vehicleId) &&
      (!search || [record.note,record.repair?.sourceAccount?.name,record.repair?.sourceAccount?.login, vehicles.find(vehicle => vehicle.id === record.vehicleId)?.vehicleNumber, vehicles.find(vehicle => vehicle.id === record.vehicleId)?.driverName].join(" ").toLocaleLowerCase().includes(search)));
    const hasRepairOverlap=category==='maintenance'&&records.some(record=>record.source!=='repair'&&record.sourceReviewId!=null&&records.some(invoice=>invoice.source==='repair'&&invoice.vehicleId===record.vehicleId&&invoice.dateFrom<=record.dateTo&&invoice.dateTo>=record.dateFrom));
    const fuelMileage=category==='fuel'&&range?await readFuelMileage(client,vehicles,records):undefined;
    const allocated=records.map(record=>({...record,allocation:range?(category==='fuel'?allocateFuelAmount(record,range,fuelMileage?.[record.vehicleId]):allocateVehicleAmount(record,range)):null}));
    const last = Math.max(1, Math.ceil(records.length / 100)); page = Math.min(page, last);
    const imports = (await client.query(`select i.file_name,i.period_from::text,i.period_to::text,min(t.work_date)::text as first_date from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id group by i.id`)).rows;
    const latest = imports.map(item => item.period_from && item.period_to ? { from: item.period_from, to: item.period_to } : resolveDriverBatchPeriod(item.file_name, item.first_date)).sort((a,b) => b.to.localeCompare(a.to))[0];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    return { vehicles, records: allocated.slice((page-1)*100,page*100),fuelMileage,
      totalCount: records.length,page,pageSize:100,hasRepairOverlap,totalAmount:hasRepairOverlap||allocated.some(record=>record.allocation?.allocatedAmount===null)?null:allocated.reduce((sum,record) => sum + Math.round((record.allocation?.allocatedAmount??record.amount)*100),0)/100,
      defaultRange: { dateFrom: latest?.from || today, dateTo: latest?.to || today },repairStatus:repairFeed?.status };
  });
}
export async function saveVehicleAmount(value: unknown) {
  let input;
  try { input = validateVehicleAmount(value); } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      await client.query("select pg_advisory_xact_lock(19431,3)");
      const vehicle = await client.query("select id from oak_vehicles where id=$1", [input.vehicleId]);
      if (!vehicle.rowCount) throw new IncomeInputError("车辆不存在");
      const current = await client.query(`select ${columns},voided_at from oak_vehicle_amounts where ${input.id ? "id=$1" : "request_key=$1"} for update`, [input.id || input.requestKey]);
      if(current.rows[0]?.voided_at)throw new IncomeInputError("该明细已删除，请刷新后新增");
      if (input.id && (!current.rowCount || Number(current.rows[0].version)!==input.version)) throw new IncomeInputError("明细已被修改，请重新读取");
      if (!input.id && current.rowCount) {
        const old=current.rows[0];
        if (["vehicleId","category","dateFrom","dateTo","amount","payeeType","note"].some(key=>old[key]!==input[key as keyof typeof input])) throw new IncomeInputError("重复请求内容不同，请刷新明细");
        await client.query("commit"); return {success:true,id:old.id,version:old.version,duplicate:true};
      }
      const values=[input.vehicleId,input.category,input.dateFrom,input.dateTo,input.amount,input.payeeType,input.note];
      const saved=input.id ? await client.query(`update oak_vehicle_amounts set vehicle_id=$1,category=$2,date_from=$3::date,date_to=$4::date,amount=$5,payee_type=$6,note=$7,
        version=version+1,updated_at=now() where id=$8 returning id::text,version`,[...values,input.id]) :
        await client.query(`insert into oak_vehicle_amounts(vehicle_id,category,date_from,date_to,amount,payee_type,note,request_key) values($1,$2,$3::date,$4::date,$5,$6,$7,$8) returning id::text,version`,[...values,input.requestKey]);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_amount',$1,$2,$3::jsonb)`,[saved.rows[0].id,input.id?"修改周期明细":"新增周期明细",JSON.stringify({before:current.rows[0]||null,after:input})]);
      await client.query("commit"); return {success:true,...saved.rows[0]};
    } catch (e) { await client.query("rollback");throw e; }
  });
}
export async function voidVehicleAmount(value: unknown) {
  const body=value as Record<string,unknown>;
  if (!body || typeof body.id!=="string" || !/^[1-9]\d{0,14}$/.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version)<1) throw new IncomeInputError("明细编号或版本无效");
  await ensureSystemSchema();
  return withSystemClient(async client=>{
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(19431,0)");
    try {
      await client.query("select pg_advisory_xact_lock(19431,3)");
      const current=await client.query(`select ${columns} from oak_vehicle_amounts where id=$1 and version=$2 and voided_at is null for update`,[body.id,body.version]);
      if(!current.rowCount)throw new IncomeInputError("明细已变化，请重新读取");
      await client.query("update oak_vehicle_amounts set voided_at=now(),updated_at=now(),version=version+1 where id=$1",[body.id]);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_amount',$1,'删除周期明细',$2::jsonb)`,[body.id,JSON.stringify(current.rows[0])]);
      await client.query("commit");return {success:true};
    }catch(e){await client.query("rollback");throw e;}
  });
}
