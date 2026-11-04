import {vehicleForSubject,type OakVehicle} from './oak-vehicles';
import {summarizeDriverTasks,driverTaskLabel,type DriverTask,type DriverDay} from './oak-driver-types';
import {allocateVehicleAmount,type VehicleAmount} from './oak-vehicle-amounts';
import type {VehicleRange} from './oak-vehicle-accounting';
import {incomeActivityGaps,type IncomeActivitySource} from './oak-income-coverage';

export const vehicleIncomeStatuses=['auto','reviewed','pending','included','replaced','manual','unlinked'] as const;
export type VehicleIncomeStatus=typeof vehicleIncomeStatuses[number];
export const vehicleIncomeStatusLabels:Record<VehicleIncomeStatus,string>={auto:'自动计价',reviewed:'人工核定',pending:'待审核',included:'已含整趟',replaced:'周期收入覆盖',manual:'周期核定',unlinked:'未关联车辆'};
export type VehicleIncomeRow={id:string;vehicleId:string|null;driverName:string;vehicleNumber:string|null;dateFrom:string;dateTo:string;
  label:string;reference:string;fromLocation:string|null;toLocation:string|null;amount:number|null;originalAmount:number|null;
  status:VehicleIncomeStatus;basis:string;task?:DriverTask;day?:DriverDay;record?:VehicleAmount;activityGap?:boolean};
export type VehicleIncomeResponse={vehicles:OakVehicle[];rows:VehicleIncomeRow[];totalCount:number;page:number;pageSize:number;range:VehicleRange;
  summary:{knownAmount:number;amount:number|null;pendingCount:number;includedCount:number;replacedCount:number;taskCount:number;manualCount:number};
  days?:DriverDay[]};
export function buildVehicleIncomeRows(vehicles:OakVehicle[],tasks:DriverTask[],records:VehicleAmount[],range:VehicleRange,sources?:IncomeActivitySource[]):VehicleIncomeRow[]{
  const incomeRecords=records.filter(record=>record.category==='income'&&record.dateFrom<=range.dateTo&&record.dateTo>=range.dateFrom);
  const days=summarizeDriverTasks(tasks);
  const dayMap=new Map(days.map(day=>[JSON.stringify([day.driverName,day.workDate]),day]));
  const links=new Map([...new Set(tasks.map(task=>task.driverName))].map(name=>[name,vehicleForSubject(vehicles,name)]));
  const rows:VehicleIncomeRow[]=tasks.map(task=>{
    const vehicle=links.get(task.driverName),income=task.income;
    const covered=vehicle&&incomeRecords.some(record=>record.vehicleId===vehicle.id&&record.dateFrom<=task.workDate&&record.dateTo>=task.workDate);
    const status:VehicleIncomeStatus=!vehicle?'unlinked':covered?'replaced':income?.status==='included'?'included':income?.status==='priced'?income.source==='manual'?'reviewed':'auto':'pending';
    return{id:`task-${task.id}`,vehicleId:vehicle?.id||null,vehicleNumber:vehicle?.vehicleNumber||null,driverName:vehicle?.driverName||task.driverName,
      dateFrom:task.workDate,dateTo:task.workDate,label:driverTaskLabel(task),reference:task.reference||'',fromLocation:task.fromLocation,toLocation:task.toLocation,
      amount:status==='unlinked'||status==='pending'?null:status==='replaced'||status==='included'?0:income?.amount??null,
      originalAmount:income?.amount??null,status,basis:!vehicle?'源表名称尚未关联车辆':covered?'该日收入已由周期核定记录覆盖，不重复相加':income?.basis||'作业收入待核对',task,
      day:dayMap.get(JSON.stringify([task.driverName,task.workDate]))};
  });
  for(const record of incomeRecords){const vehicle=vehicles.find(vehicle=>vehicle.id===record.vehicleId);if(!vehicle)continue;
    rows.push({id:`manual-${record.id}`,vehicleId:vehicle.id,vehicleNumber:vehicle.vehicleNumber,driverName:vehicle.driverName,dateFrom:record.dateFrom,dateTo:record.dateTo,
      label:'周期收入核定',reference:record.note,fromLocation:null,toLocation:null,amount:allocateVehicleAmount(record,range).allocatedAmount,originalAmount:record.amount,status:'manual',basis:record.note,record});
  }
  if(sources)for(const gap of incomeActivityGaps(records,sources,range)){const vehicle=vehicles.find(vehicle=>vehicle.id===gap.vehicleId);if(!vehicle)continue;
    rows.push({id:`gap-${gap.id}`,vehicleId:vehicle.id,vehicleNumber:vehicle.vehicleNumber,driverName:vehicle.driverName,dateFrom:gap.dateFrom,dateTo:gap.dateTo,label:'作业待同步',reference:gap.fileName,
      fromLocation:null,toLocation:null,amount:null,originalAmount:null,status:'pending',basis:`${gap.sheetName} 的工资已入账，但尚未提取本文件的作业`,activityGap:true});
  }
  return rows.sort((a,b)=>b.dateFrom.localeCompare(a.dateFrom)||a.driverName.localeCompare(b.driverName,'zh-CN')||a.id.localeCompare(b.id,undefined,{numeric:true}));
}
export function summarizeVehicleIncome(rows:VehicleIncomeRow[]):VehicleIncomeResponse['summary']{
  const pendingCount=rows.filter(row=>row.status==='pending'||row.status==='unlinked').length;
  const knownAmount=rows.reduce((sum,row)=>sum+Math.round((row.amount??0)*100),0)/100;
  return{knownAmount,amount:pendingCount||!rows.length?null:knownAmount,pendingCount,includedCount:rows.filter(row=>row.status==='included').length,
    replacedCount:rows.filter(row=>row.status==='replaced').length,taskCount:rows.filter(row=>row.task).length,manualCount:rows.filter(row=>row.record).length};
}
export function incomeMapDays(tasks:DriverTask[],vehicle:OakVehicle):DriverDay[]{
  const groups=new Map<string,DriverTask[]>();
  for(const task of tasks)groups.set(task.workDate,[...(groups.get(task.workDate)||[]),task]);
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([workDate,tasks])=>({workDate,driverName:vehicle.driverName,tasks,taskCount:tasks.length,
    miles:tasks.some(task=>task.miles!=null)?tasks.reduce((sum,task)=>sum+(task.miles??0),0):null}));
}
