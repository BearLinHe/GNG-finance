import type {PoolClient} from 'pg';
import type {OakVehicle} from './oak-vehicles';
import type {VehicleAmount} from './oak-vehicle-amounts';
import {buildFuelMileageContexts,type FuelMileageContext} from './oak-fuel';

export async function readFuelMileage(client:PoolClient,vehicles:OakVehicle[],records:VehicleAmount[]):Promise<Record<string,FuelMileageContext>>{
 const fuel=records.filter(record=>record.category==='fuel');if(!fuel.length)return {};
 const from=fuel.map(record=>record.dateFrom).sort()[0],to=fuel.map(record=>record.dateTo).sort().at(-1)!;
 const {rows}=await client.query(`with relevant as (
   select t.id,t.driver_name,t.sheet_name,t.work_date,t.miles,i.file_hash,i.file_name,i.period_from,i.period_to
   from oak_driver_tasks t join oak_driver_imports i on i.id=t.import_id
   where (t.work_date between $1::date and $2::date) or (i.period_from<=$2::date and i.period_to>=$1::date)
  ), daily as (
   select driver_name,work_date,case when count(*) filter(where miles is null or miles<0)>0 then null else sum(miles)::float8 end as miles
   from relevant where work_date between $1::date and $2::date group by driver_name,work_date
  ), sources as (select driver_name,sheet_name,file_hash,file_name,period_from,period_to,jsonb_agg(id::text order by id) as task_ids
    from relevant group by driver_name,sheet_name,file_hash,file_name,period_from,period_to)
  select
   coalesce((select jsonb_agg(jsonb_build_object('driverName',driver_name,'workDate',work_date::text,'miles',miles)) from daily),'[]') as days,
   coalesce((select jsonb_agg(jsonb_build_object('driverName',driver_name,'sheetName',sheet_name,'fileHash',file_hash,'fileName',file_name,'dateFrom',period_from::text,'dateTo',period_to::text,'taskIds',task_ids)) from sources),'[]') as sources,
   coalesce((select jsonb_agg(jsonb_build_object('vehicleId',vehicle_id,'dateFrom',date_from::text,'dateTo',date_to::text,'payroll',payroll_source)) from oak_vehicle_amounts
    where category='labor' and voided_at is null and payroll_source is not null and date_from<=$2::date and date_to>=$1::date),'[]') as wages`,[from,to]);
 return buildFuelMileageContexts(vehicles,rows[0].days,rows[0].sources,rows[0].wages);
}
