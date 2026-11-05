import type {PoolClient} from 'pg';
import {ensureSystemSchema,withSystemClient} from './system-db';
import {parseDriverWorkbook} from './oak-driver-import';
import {readOakVehicles} from './oak-vehicles-db';
import {assertUniqueVehicleLinks,vehicleForSubject,type OakVehicle} from './oak-vehicles';
import {incomeText} from './oak-income';
import type {DriverWorkbookPreview} from './oak-driver-types';
import type {PayeeType} from './oak-payee';
import type {DriverTask} from './oak-driver-types';
import {readVehicleAmounts} from './oak-vehicle-amounts-db';
import {savePayrollActivityLink} from './oak-payroll-activity-db';

export type IncomeSheetMapping={sheetName:string;vehicleId:string;payeeType:PayeeType|null};
export function validateIncomeSheetMappings(value:unknown,preview:DriverWorkbookPreview):IncomeSheetMapping[]{
  if(!Array.isArray(value)||!value.length||value.length>100)throw Error('请选择 1 至 100 张有作业的工作表');
  const seen=new Set<string>();
  return value.map(item=>{
    if(!item||typeof item!=='object'||typeof item.sheetName!=='string'||!item.sheetName.trim()||item.sheetName.length>120)throw Error('工作表名称无效，请重新选择文件');
    // Sheet names are source keys; trimming would break names such as " O王肃".
    const sheetName=item.sheetName;
    if(seen.has(sheetName))throw Error(`工作表“${sheetName}”被重复选择，请核对`);seen.add(sheetName);
    const sheet=preview.sheets.find(sheet=>sheet.sheetName===sheetName);
    if(!sheet)throw Error(`文件中没有工作表“${sheetName}”，请重新选择文件`);
    if(!sheet.taskCount)throw Error(`工作表“${sheetName}”没有可导入的作业，请取消勾选`);
    if(item.payeeType!==null&&item.payeeType!=='driver'&&item.payeeType!=='owner')throw Error(`工作表“${sheetName}”的作业身份无效`);
    return{sheetName,vehicleId:incomeText(item.vehicleId,60,true)!,payeeType:item.payeeType};
  });
}
function taskSignature(task:Pick<DriverTask,'workDate'|'reference'|'nature'|'fromLocation'|'toLocation'|'miles'|'section'>){
  return JSON.stringify([task.workDate,task.reference,task.nature,task.fromLocation,task.toLocation,task.miles,task.section]);
}
function sameSheetWork(left:DriverTask[],right:DriverTask[]){
  const ordered=(tasks:DriverTask[])=>[...tasks].sort((a,b)=>a.section.localeCompare(b.section)||a.sourceRow-b.sourceRow).map(taskSignature);
  return left.length===right.length&&JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
}

async function reuseMatchingWorkbook(client:PoolClient,preview:DriverWorkbookPreview,mappings:IncomeSheetMapping[],vehicles:OakVehicle[],batch:{id:string;fileHash:string;dateFrom:string|null;dateTo:string|null}){
  const period={dateFrom:preview.batchPeriod.from,dateTo:preview.batchPeriod.to};
  if(batch.dateFrom!==period.dateFrom||batch.dateTo!==period.dateTo)return null;
  const existing=(await client.query(`select id::text,sheet_name as "sheetName",driver_name as "driverName",section,source_row as "sourceRow",
    work_date::text as "workDate",reference,nature,from_location as "fromLocation",to_location as "toLocation",miles::float8,payee_type as "payeeType"
    from oak_driver_tasks where import_id=$1 and sheet_name=any($2::text[]) order by id`,[batch.id,mappings.map(mapping=>mapping.sheetName)])).rows as DriverTask[];
  const scoped=mappings.map(mapping=>({mapping,old:existing.filter(task=>task.sheetName===mapping.sheetName),incoming:preview.tasks.filter(task=>task.sheetName===mapping.sheetName)}));
  if(scoped.some(({mapping,old,incoming})=>!old.length||old.some(task=>!task.id||vehicleForSubject(vehicles,task.driverName)?.id!==mapping.vehicleId
    ||(task.payeeType&&mapping.payeeType&&task.payeeType!==mapping.payeeType))||!sameSheetWork(old,incoming)))return null;
  const wages=await readVehicleAmounts(client,period);
  for(const {mapping,old} of scoped){
    for(const wage of wages.filter(wage=>wage.category==='labor'&&wage.vehicleId===mapping.vehicleId&&wage.dateFrom===period.dateFrom&&wage.dateTo===period.dateTo
      &&wage.payroll?.fileHash===preview.fileHash&&wage.payroll?.sheetName===mapping.sheetName)){
      await savePayrollActivityLink(client,wage,{...period,fileHash:batch.fileHash,sheetName:mapping.sheetName,vehicleId:mapping.vehicleId,taskIds:old.map(task=>task.id!)},'同车同周期的工作表逐段比对一致，复用已有作业');
    }
  }
  return {added:0,skipped:existing.length};
}
export async function previewIncomeWorkbook(buffer:Buffer,fileName:string){
  const preview=await parseDriverWorkbook(buffer,fileName);await ensureSystemSchema();
  return withSystemClient(async client=>{
    const vehicles=await readOakVehicles(client);
    const existing=(await client.query(`select t.sheet_name,count(*)::int as count from oak_driver_tasks t join oak_driver_imports i on i.id=t.import_id where i.file_hash=$1 group by t.sheet_name`,[preview.fileHash])).rows;
    return{fileName:preview.fileName,fileHash:preview.fileHash,batchPeriod:preview.batchPeriod,vehicles,warnings:preview.warnings,
      sheets:preview.sheets.map(sheet=>{const vehicle=vehicleForSubject(vehicles,sheet.driverName),count=Number(existing.find(row=>row.sheet_name===sheet.sheetName)?.count||0);return{...sheet,vehicleId:vehicle?.id||'',existingCount:count,selected:Boolean(vehicle&&sheet.taskCount>count&&!sheet.warnings.length)};})};
  });
}
export async function mergeIncomeWorkbook(client:PoolClient,preview:DriverWorkbookPreview,mappings:IncomeSheetMapping[],vehicles:OakVehicle[]){
  mappings=validateIncomeSheetMappings(mappings,preview);
  const seen=new Set(mappings.map(mapping=>mapping.sheetName));
  for(const mapping of mappings){
    const vehicle=vehicles.find(vehicle=>vehicle.id===mapping.vehicleId);if(!vehicle)throw Error(`${mapping.sheetName}：请选择车辆`);
    const old=vehicleForSubject(vehicles,mapping.sheetName);
    if(old&&old.id!==vehicle.id)throw Error(`${mapping.sheetName} 已关联 ${old.vehicleNumber||old.driverName}，请先核对车辆资料`);
    if(!old){
      const next={...vehicle,aliases:[...new Set([...vehicle.aliases,mapping.sheetName])]};assertUniqueVehicleLinks(vehicles.map(item=>item.id===vehicle.id?next:item));
      await client.query('update oak_vehicles set aliases=$2::jsonb,version=version+1,updated_at=now() where id=$1',[vehicle.id,JSON.stringify(next.aliases)]);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle',0,'确认周表作业关联',$1::jsonb)`,[JSON.stringify({before:vehicle,after:next})]);vehicle.aliases=next.aliases;vehicle.version++;
    }
  }
  const otherVersions=await client.query(`select i.id::text,i.file_hash as "fileHash",i.period_from::text as "dateFrom",i.period_to::text as "dateTo"
    from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id
    where i.file_name=$1 and i.file_hash<>$2 group by i.id
    having coalesce(i.period_from,min(t.work_date))<=$4::date and coalesce(i.period_to,max(t.work_date))>=$3::date limit 2`,[preview.fileName,preview.fileHash,preview.batchPeriod.from,preview.batchPeriod.to]);
  if(otherVersions.rowCount){
    const reused=otherVersions.rowCount===1?await reuseMatchingWorkbook(client,preview,mappings,vehicles,otherVersions.rows[0]):null;
    if(reused)return reused;
    throw Error('同一周期周表已存在不同版本，作业无法确认完全一致，请核对，未重复新增');
  }
  const selected=preview.tasks.filter(task=>seen.has(task.sheetName));
  const dates=selected.map(task=>task.workDate).sort();
  const previous=(await client.query(`select t.driver_name as "driverName",t.work_date::text as "workDate",t.reference,t.nature,t.from_location as "fromLocation",t.to_location as "toLocation",t.miles::float8 as miles,t.section
    from oak_driver_tasks t join oak_driver_imports i on i.id=t.import_id where i.file_hash<>$1 and t.work_date between $2::date and $3::date`,[preview.fileHash,dates[0],dates.at(-1)])).rows as DriverTask[];
  const priorKeys=new Set(previous.map(task=>JSON.stringify([vehicleForSubject(vehicles,task.driverName)?.id,taskSignature(task)])));
  if(selected.some(task=>priorKeys.has(JSON.stringify([mappings.find(mapping=>mapping.sheetName===task.sheetName)!.vehicleId,taskSignature(task)]))))throw Error('已有其他文件包含同一车辆、日期及作业，请先核对周表版本，未重复新增');
  let batch=(await client.query('select id::int from oak_driver_imports where file_hash=$1 for update',[preview.fileHash])).rows[0];
  if(!batch)batch=(await client.query(`insert into oak_driver_imports(file_name,file_hash,period_from,period_to) values($1,$2,$3::date,$4::date) returning id::int`,[preview.fileName,preview.fileHash,preview.batchPeriod.from,preview.batchPeriod.to])).rows[0];
  const existing=(await client.query('select sheet_name,section,source_row,driver_name,payee_type from oak_driver_tasks where import_id=$1',[batch.id])).rows;
  const keys=new Map(existing.map(row=>[JSON.stringify([row.sheet_name,row.section,row.source_row]),row]));
  let skipped=0;
  const added=selected.filter(task=>{
    const old=keys.get(JSON.stringify([task.sheetName,task.section,task.sourceRow]));if(!old)return true;
    const mapping=mappings.find(mapping=>mapping.sheetName===task.sheetName)!;
    if(vehicleForSubject(vehicles,old.driver_name)?.id!==mapping.vehicleId||(old.payee_type&&mapping.payeeType&&old.payee_type!==mapping.payeeType))throw Error(`${task.sheetName} 的已导入作业归属不同，未覆盖原记录`);
    skipped++;return false;
  }).map(task=>({...task,payeeType:mappings.find(mapping=>mapping.sheetName===task.sheetName)!.payeeType}));
  if(added.length)await client.query(`insert into oak_driver_tasks(import_id,sheet_name,section,source_row,driver_name,work_date,reference,nature,from_location,to_location,miles,notes,raw_cells,payee_type)
    select $1,t."sheetName",t.section,t."sourceRow",t."driverName",t."workDate"::date,t.reference,t.nature,t."fromLocation",t."toLocation",t.miles,t.notes,t."rawCells",t."payeeType"
    from jsonb_to_recordset($2::jsonb) as t("sheetName" text,section text,"sourceRow" int,"driverName" text,"workDate" text,reference text,nature text,"fromLocation" text,"toLocation" text,miles numeric,notes text,"rawCells" jsonb,"payeeType" text)`,[batch.id,JSON.stringify(added)]);
  await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('driver_import',$1,'同步周表作业',$2::jsonb)`,[batch.id,JSON.stringify({fileName:preview.fileName,mappings,added:added.length,skipped})]);
  return{added:added.length,skipped};
}
export async function importIncomeWorkbook(buffer:Buffer,fileName:string,value:unknown){
  const preview=await parseDriverWorkbook(buffer,fileName);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('作业关联内容无效');
  const body=value as {mappings:unknown;confirmedWarnings?:boolean};
  const mappings=validateIncomeSheetMappings(body.mappings,preview);
  if((preview.warnings.length||preview.sheets.some(sheet=>mappings.some(mapping=>mapping.sheetName===sheet.sheetName)&&sheet.warnings.length))&&body.confirmedWarnings!==true)throw Error('原表含日期或重复路线提示，请先核对并确认');
  await ensureSystemSchema();return withSystemClient(async client=>{
    await client.query('begin');try{await client.query('select pg_advisory_xact_lock_shared(19431,0)');for(const lock of[2,3])await client.query('select pg_advisory_xact_lock(19431,$1)',[lock]);
      const result=await mergeIncomeWorkbook(client,preview,mappings,await readOakVehicles(client));await client.query('commit');return result;
    }catch(error){await client.query('rollback');throw error;}
  });
}
