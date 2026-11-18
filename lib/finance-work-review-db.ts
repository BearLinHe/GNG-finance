import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSystemClient } from './system-db';
import { AssistantInputError, dateRange } from './finance-assistant';
import { driverDirectory } from './oak-driver-accounting';
import { assertIncomeTasksEditable, readIncomeReviews, readIncomeRules, taskFromRow, writeIncomeReviewLocked } from './oak-income-db';
import { prepareWorkBatch, type WorkBook, type WorkScope } from './finance-work-review';
import type { OakVehicle } from './oak-vehicles';

async function load(client:PoolClient,scope:WorkScope):Promise<WorkBook> {
  const fleet=(await client.query<OakVehicle>('select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles order by id')).rows;
  const names=(await client.query<{driver_name:string}>('select distinct driver_name from oak_driver_tasks where work_date=$1::date',[scope.date])).rows.map(r=>r.driver_name);
  const {keyFor}=driverDirectory(fleet,names), key=keyFor(scope.driver);
  if(!key)throw new AssistantInputError('不能唯一确定司机，请提供司机姓名（不是车号）');
  const subjects=names.filter(n=>keyFor(n)===key);
  const tasks=subjects.length ? (await client.query(`select t.*,t.work_date::text as date_text from oak_driver_tasks t
    where (t.import_id,t.driver_name) in (select import_id,driver_name from oak_driver_tasks where driver_name=any($1::text[]) and work_date=$2::date)
    order by t.work_date,t.import_id,t.sheet_name,t.source_row,t.id limit 501`,[subjects,scope.date])).rows.map(taskFromRow) : [];
  if(tasks.length>500)throw new AssistantInputError('关联周表过大，请在车辆收入页核对，未截断或修改工单');
  const ids=tasks.map(t=>t.id!);
  const lockedIds=ids.length?(await client.query<{id:string}>(`select distinct st.task_id::text as id from oak_settlement_tasks st
    join oak_weekly_settlements s on s.id=st.settlement_id where s.status='confirmed' and st.task_id=any($1::bigint[])`,[ids])).rows.map(r=>r.id):[];
  return {scope,fleet,tasks,rules:await readIncomeRules(client),reviews:await readIncomeReviews(client,ids),lockedIds};
}
export async function findDriverWork(args:Record<string,unknown>) {
  if(typeof args.driver!=='string'||!args.driver.trim()||args.driver.length>100)throw new AssistantInputError('请指定一位司机');
  const date=dateRange({dateFrom:args.date,dateTo:args.date}).dateFrom,scope={driver:args.driver.trim(),date};
  return withSystemClient(async client=>{
    await client.query('begin isolation level repeatable read read only');
    try{const book=await load(client,scope);await client.query('commit');return book;}
    catch(e){await client.query('rollback');throw e;}
  });
}
type Pending={scope:WorkScope;raw:unknown;words:string;stamp:string;expires:number;busy:boolean;ids?:string[]};
const mem=globalThis as typeof globalThis & {oakWorkReviewDrafts?:Map<string,Pending>};
const pending=mem.oakWorkReviewDrafts??=new Map<string,Pending>();
export function previewWorkBatch(book:WorkBook,raw:unknown,words:string) {
  const draft=prepareWorkBatch(book,raw,words);
  for(const [key,d] of pending)if(!d.busy&&d.expires<=Date.now())pending.delete(key);
  if(pending.size>=128)throw new AssistantInputError('待确认批次过多，请稍后再试');
  const token=randomUUID();
  pending.set(token,{scope:book.scope,raw,words,stamp:draft.stamp,expires:Date.now()+900000,busy:false});
  return {token,rows:draft.preview};
}
export function discardWorkBatch(token:unknown){
  if(typeof token!=='string')throw new AssistantInputError('核对批次无效');
  const d=pending.get(token);
  if(d?.busy||d?.ids)throw new AssistantInputError('该批次正在保存或已保存');
  pending.delete(token);
}
const persistence={withClient:withSystemClient,load,assertEditable:assertIncomeTasksEditable,write:writeIncomeReviewLocked};
export async function confirmWorkBatch(token:unknown,db=persistence){
  const d=typeof token==='string'?pending.get(token):undefined;
  if(!d||d.expires<=Date.now())throw new AssistantInputError('核对预览已失效，请重新查询');
  if(d.ids)return d.ids;
  if(d.busy)throw new AssistantInputError('正在保存这批工单');
  d.busy=true;
  try{
    const ids=await db.withClient(async client=>{
      await client.query('begin');
      try{
        await client.query('select pg_advisory_xact_lock_shared(19431,0)');
        for(const lock of [1,2,3])await client.query('select pg_advisory_xact_lock(19431,$1)',[lock]);
        const batch=prepareWorkBatch(await db.load(client,d.scope),d.raw,d.words);
        if(batch.stamp!==d.stamp)throw new AssistantInputError('工单、主作业或计价依据已变化，请重新生成预览。整批未保存。');
        await db.assertEditable(client,batch.preview.map(r=>r.id));
        for(const change of batch.changes)await db.write(client,change);
        await client.query('commit');return batch.changes.map(c=>c.taskId);
      }catch(e){await client.query('rollback');throw e;}
    });
    d.ids=ids;return ids;
  }finally{d.busy=false;}
}
