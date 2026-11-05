import {ensureSystemSchema,withSystemClient} from './system-db';
import {IncomeInputError,readRatedDriverTasks} from './oak-income-db';
import {readOakVehicles} from './oak-vehicles-db';
import {readVehicleAmounts} from './oak-vehicle-amounts-db';
import {vehicleRange,type VehicleRange} from './oak-vehicle-accounting';
import {vehicleForSubject} from './oak-vehicles';
import {readIncomeActivitySources} from './oak-payroll-activity-db';
import {buildVehicleIncomeRows,incomeMapDays,summarizeVehicleIncome,vehicleIncomeStatuses,type VehicleIncomeResponse} from './oak-vehicle-income';

export async function listVehicleIncome(params:URLSearchParams):Promise<VehicleIncomeResponse>{
  let range:VehicleRange|undefined;try{
    if(params.get('dateFrom')||params.get('dateTo'))range=vehicleRange(Object.fromEntries(params));
    if((params.get('search')||'').length>120)throw Error('搜索内容过长');
  }catch(error){throw new IncomeInputError((error as Error).message);}
  const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||100),status=params.get('status')||'all';
  if(!Number.isSafeInteger(page)||page<1||![100,200,300].includes(pageSize)||status!=='all'&&!vehicleIncomeStatuses.some(value=>value===status))throw new IncomeInputError('分页或状态无效');
  await ensureSystemSchema();
  return withSystemClient(async client=>{
    await client.query('begin isolation level repeatable read');
    try{
      await client.query('select pg_advisory_xact_lock_shared(19431,0)');
      const vehicles=await readOakVehicles(client),vehicleId=params.get('vehicleId')||'';
      if(vehicleId&&!vehicles.some(vehicle=>vehicle.id===vehicleId))throw new IncomeInputError('车辆不存在');
      const bounds=(await client.query(`select min(date_from)::text as "dateFrom",max(date_to)::text as "dateTo" from (
        select min(work_date) as date_from,max(work_date) as date_to from oak_driver_tasks
        union all select min(date_from),max(date_to) from oak_vehicle_amounts where category='income' and voided_at is null) a`)).rows[0];
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const scope=range||{dateFrom:bounds.dateFrom||today,dateTo:bounds.dateTo||today};
      const tasks=await readRatedDriverTasks(client,scope),amounts=await readVehicleAmounts(client,scope);
      const sources=await readIncomeActivitySources(client,vehicles);
      let rows=buildVehicleIncomeRows(vehicles,tasks,amounts,scope,sources).filter(row=>!vehicleId||row.vehicleId===vehicleId);
      const search=(params.get('search')||'').trim().toLocaleLowerCase();
      if(search)rows=rows.filter(row=>[row.driverName,row.vehicleNumber,row.label,row.reference,row.fromLocation,row.toLocation,row.basis,row.task?.fileName].join(' ').toLocaleLowerCase().includes(search));
      const summary=summarizeVehicleIncome(rows);
      if(status!=='all')rows=rows.filter(row=>row.status===status);
      const totalCount=rows.length,currentPage=Math.min(page,Math.max(1,Math.ceil(totalCount/pageSize)));
      const result:VehicleIncomeResponse={vehicles,range:scope,rows:rows.slice((currentPage-1)*pageSize,currentPage*pageSize),totalCount,page:currentPage,pageSize,summary};
      if(params.get('days')==='1'){
        if(!vehicleId||!range||Date.parse(range.dateTo)-Date.parse(range.dateFrom)>30*86400000)throw new IncomeInputError('地图请选择一辆车及最多 31 天');
        result.days=incomeMapDays(tasks.filter(task=>vehicleForSubject(vehicles,task.driverName)?.id===vehicleId),vehicles.find(vehicle=>vehicle.id===vehicleId)!);
      }
      await client.query('commit');return result;
    }catch(error){await client.query('rollback');throw error;}
  });
}
