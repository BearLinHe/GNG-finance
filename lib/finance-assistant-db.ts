import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AssistantInputError, checkBatch, dateRange, kindLabels, prepareEdit, recheckEdit, type PreparedEdit } from './finance-assistant';
import { withSystemClient } from './system-db';
import { readVehicleAmounts, writeVehicleAmountLocked } from './oak-vehicle-amounts-db';
import { driverDirectory } from './oak-driver-accounting';
import { readDriverAccounting } from './oak-driver-accounting-db';
import type { OakVehicle } from './oak-vehicles';

const vehicles=async(client:PoolClient)=>(await client.query<OakVehicle>(`select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles`)).rows;
export async function queryDriver(args:Record<string,unknown>) {
  const range=dateRange(args);
  if(typeof args.driver!=='string'||!args.driver.trim()||args.driver.length>100) throw new AssistantInputError('请选择司机姓名');
  const directory=driverDirectory(await withSystemClient(vehicles),[]);
  const key=directory.keyFor(args.driver.trim());
  if(!key) throw new AssistantInputError('不能用车号推测司机，请提供司机姓名');
  const result=await readDriverAccounting(new URLSearchParams({...range,driverKey:key}));
  const summary=(line:typeof result.profit.fuel)=>({confirmed:line.amount,knownSubtotal:line.subtotal,pending:line.pending});
  return {...range,driver:result.drivers.find(d=>d.key===key)?.name,income:summary(result.profit.income),wages:summary(result.profit.labor),fuel:summary(result.profit.fuel),insurance:summary(result.profit.insurance),maintenance:summary(result.profit.maintenance),net:result.profit.net,
    vehicles:result.profit.periods.map(p=>({dateFrom:p.dateFrom,dateTo:p.dateTo,number:result.vehicles.find(v=>v.id===p.vehicleId)?.vehicleNumber??null}))};
}

export async function queryLedger(args:Record<string,unknown>) {
  const range=dateRange(args),category=args.category,number=args.vehicleNumber;
  if((category!==null && (typeof category!=='string'||!Object.hasOwn(kindLabels,category))) || (number!==null && (typeof number!=='string'||number.length>50))) throw new AssistantInputError('无效的账本筛选条件');
  return withSystemClient(async client=>{
    const where=`from oak_vehicle_amounts a join oak_vehicles v on v.id=a.vehicle_id where a.voided_at is null
      and a.date_from >= $1::date and a.date_to <= $2::date and ($3::text is null or a.category=$3) and ($4::text is null or v.vehicle_number=$4)`;
    const params=[range.dateFrom,range.dateTo,category,number];
    await client.query('begin isolation level repeatable read read only');
    try {
      const totals=(await client.query(`select a.category,count(*)::int as count,sum(a.amount)::float8 as usd ${where} group by a.category order by a.category`,params)).rows;
      const records=(await client.query(`select a.id::text,a.category,v.vehicle_number as "vehicleNumber",a.date_from::text as "dateFrom",a.date_to::text as "dateTo",a.amount::float8 as usd ${where} order by a.date_from desc,a.id desc limit 40`,params)).rows;
      await client.query('commit');
      return {...range,vehicleNumber:number,category,scope:'账期完整落入区间的本系统明细，不分摊；不含外接维修库和工单自动收入',totals,records};
    } catch(e){await client.query('rollback');throw e;}
  });
}

type Draft={expires:number; edits:PreparedEdit[]; busy:boolean; result?:string[]};
const state=globalThis as typeof globalThis & {oakAssistantDrafts?:Map<string,Draft>};
const drafts=state.oakAssistantDrafts??=new Map<string,Draft>();
export async function previewDraft(raw:unknown) {
  if(!Array.isArray(raw)||!raw.length||raw.length>40||raw.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new AssistantInputError('每批可核对 1 至 40 条明细');
  const edits=await withSystemClient(async client=>{
    const fleet=await vehicles(client);
    const ranges=raw.map(r=>dateRange(r));
    const records=await readVehicleAmounts(client,{dateFrom:ranges.map(r=>r.dateFrom).sort()[0],dateTo:ranges.map(r=>r.dateTo).sort().at(-1)!});
    return raw.map(row=>prepareEdit(row,fleet,records));
  });
  checkBatch(edits);
  for(const [id,d] of drafts) if(!d.busy && d.expires<=Date.now()) drafts.delete(id);
  if(drafts.size>=128) throw new AssistantInputError('未过期草稿过多，请稍后重试');
  const token=randomUUID();drafts.set(token,{edits,expires:Date.now()+15*60_000,busy:false});
  return {token,rows:edits.map(e=>e.row)};
}

export function discardDraft(token:unknown) {
  if(typeof token!=='string')throw new AssistantInputError('草稿编号无效');
  const d=drafts.get(token);
  if(d?.busy||d?.result)throw new AssistantInputError('该草稿正在保存或已经入账');
  drafts.delete(token);
}

export async function confirmDraft(token:unknown) {
  const d=typeof token==='string'?drafts.get(token):undefined;
  if(!d||d.expires<=Date.now())throw new AssistantInputError('草稿已失效，请重新核对');
  if(d.result)return d.result;
  if(d.busy)throw new AssistantInputError('这批明细正在保存');
  d.busy=true;
  try{
    const ids=await withSystemClient(async client=>{
      await client.query('begin');
      try{
        await client.query('select pg_advisory_xact_lock_shared(19431,0)');
        await client.query('select pg_advisory_xact_lock(19431,3)');
        const fleet=await vehicles(client);
        const records=await readVehicleAmounts(client,{dateFrom:d.edits.map(e=>e.row.dateFrom).sort()[0],dateTo:d.edits.map(e=>e.row.dateTo).sort().at(-1)!});
        const ids:string[]=[];
        for(const e of d.edits){
          recheckEdit(e,fleet,records);
          const written=await writeVehicleAmountLocked(client,e.input,'本地财务助手 · 人工确认');
          ids.push(String(written.id));
        }
        await client.query('commit');return ids;
      }catch(error){await client.query('rollback');throw error;}
    });
    d.result=ids;return ids;
  }finally{d.busy=false;}
}
