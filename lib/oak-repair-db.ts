import {Pool} from 'pg';
import type {OakVehicle} from './oak-vehicles';
import {excludedRepairOwnerIds,normalizeRepairInvoices,repairUnitAliases,type RepairFeed} from './oak-repair';
import {createAsyncReadCache} from './async-read-cache';
let pool:Pool|undefined;
const feedCache=createAsyncReadCache<RepairFeed>({ttlMs:30000,maxEntries:4,cacheable:feed=>feed.status.available});
export function repairUnitMatchSql(column:'unit_number'|'c.unit_number'){
 // Match the same known owner annotation as repairUnitKey before filtering source rows.
 return `regexp_replace(regexp_replace(upper(btrim(translate(${column},'（）','()'))),'[[:space:]]+',' ','g'),' *[(]车主[)]$','')`;
}
export function readRepairFeed(vehicles:OakVehicle[],fresh=false):Promise<RepairFeed>{
 const key=JSON.stringify([process.env.REPAIR_DATABASE_URL,vehicles.map(vehicle=>[vehicle.id,vehicle.vehicleNumber]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
 return feedCache.read(key,()=>loadRepairFeed(vehicles),fresh);
}
async function loadRepairFeed(vehicles:OakVehicle[]):Promise<RepairFeed>{
 const url=process.env.REPAIR_DATABASE_URL;
 if(!url)return{records:[],status:{configured:false,available:false,message:'维修库未配置 REPAIR_DATABASE_URL',matchedVehicleIds:[],warnings:[]}};
 try{
  if(!pool)pool=new Pool({connectionString:url,max:2,idleTimeoutMillis:20000,connectionTimeoutMillis:8000});
  const client=await pool.connect();
  try{
   await client.query('begin read only');
   await client.query('set local statement_timeout=12000');
   const units=[...new Set(vehicles.flatMap(vehicle=>repairUnitAliases(vehicle.vehicleNumber)))];
   const cases=(await client.query(`select distinct unit_number,clerk_user_id from "Case" where ${repairUnitMatchSql('unit_number')}=any($1::text[]) and not(clerk_user_id=any($2::text[]))`,[units,excludedRepairOwnerIds])).rows;
   const invoices=(await client.query(`select i.id,i.case_id,i.invoice_number,i.clerk_user_id as invoice_owner_id,account.name as account_name,account.login as account_login,i.payment_status,i.grand_total_cents,i.parts_revenue_cents,i.labor_revenue_cents,i.cleaning_fee_cents,i.tax_cents,i.snapshot,
     c.status as case_status,c.clerk_user_id,c.unit_number,c.plate,c.bill_to_company,extract(epoch from c.check_in_at)*1000 as check_in_ms,extract(epoch from i.issued_at)*1000 as issued_ms,extract(epoch from i.updated_at)*1000 as updated_ms,
     (select extract(epoch from max(l.changed_at))*1000 from "CaseStatusLog" l where l.case_id=c.id and l.to_status='COMPLETED') as completed_ms,
     coalesce((select jsonb_agg(jsonb_build_object('name',r.name) order by r.sort_order,r.id) from "CaseRepairItem" r where r.case_id=c.id),'[]') as repair_items,
     coalesce((select jsonb_agg(jsonb_build_object('name',p.name,'qty',p.qty,'unit_price_cents',p.unit_price_cents,'line_total_cents',p.line_total_cents) order by p.created_at,p.id) from "CasePart" p where p.case_id=c.id),'[]') as parts,
     coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'hours',l.hours,'rate_cents',l.rate_cents,'line_total_cents',l.line_total_cents) order by l.created_at,l.id) from "CaseLabor" l where l.case_id=c.id),'[]') as labor
     from "InvoiceRecord" i join "Case" c on c.id=i.case_id
     left join lateral (select a.name,a.login from "AppUser" a where a.data_owner_id=i.clerk_user_id or a.id=i.clerk_user_id order by (a.data_owner_id=i.clerk_user_id) desc limit 1) account on true
     where c.status='COMPLETED' and i.payment_status<>'VOID' and ${repairUnitMatchSql('c.unit_number')}=any($1::text[])
     and not(c.clerk_user_id=any($2::text[])) and not(i.clerk_user_id=any($2::text[]))
     order by i.issued_at,i.id`,[units,excludedRepairOwnerIds])).rows;
   await client.query('commit');return normalizeRepairInvoices(vehicles,cases,invoices);
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
 }catch{return{records:[],status:{configured:true,available:false,message:'维修库暂时无法读取，维修费用待核对',matchedVehicleIds:[],warnings:[]}};}
}
